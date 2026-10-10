/*
 * pipeline.cxx — the per-pipeline runtime (ADR-018).
 */
#include "wake/pipeline.h"

#include <stdlib.h>
#include <string.h>
#include <new>

#include "wake/afe_graph.h"
#include "wake/resample.h"

struct wake_pipeline {
  wake_afe_graph_t *graph;
  const wake_kws_backend_ops_t *backend_ops;
  void *backend_impl;
  wake_score_smoother_t *smoother;
  wake_trigger_detector_t *trigger;
  wake_vad_gate_t *gate;
  /* AFE-internal rate -> KWS boundary rate (#245 slice C). One conversion for the
   * whole pipeline, instead of every 48 kHz stage converting for itself. */
  wake_resampler_t *boundary;
  int16_t kws_frame[WAKE_SDK_KWS_FRAME_SAMPLES];
  /* A trigger the detector accepted while the VAD gate was closed. It is
   * published as soon as the gate opens or the hold window expires. */
  wake_trigger_event_t pending;
  int pending_valid;
  wake_kws_config_t cfg;
};

wake_pipeline_t *wake_pipeline_create(wake_sdk_t *sdk, const char *backend_id,
                                      const wake_kws_config_t *cfg,
                                      const wake_model_bundle_t *models) {
  if (sdk == nullptr || backend_id == nullptr) {
    return nullptr;
  }

  void *mem = calloc(1, sizeof(wake_pipeline));
  if (mem == nullptr) {
    return nullptr;
  }
  wake_pipeline *p = new (mem) wake_pipeline;

  p->cfg = cfg ? *cfg : wake_kws_config_t WAKE_KWS_CONFIG_DEFAULT;
  if (p->cfg.smoothing_window_frames == 0) {
    p->cfg.smoothing_window_frames = 5;
  }

  /* AFE graph in ADR-001 order (aec → bss → ns), built from the stages the
   * composition root registered. Missing stages degrade gracefully. */
  p->graph = wake_afe_graph_create();
  if (p->graph == nullptr) {
    free(p);
    return nullptr;
  }
  const char *kOrder[] = {"aec", "bss", "ns"};
  for (const char *id : kOrder) {
    const wake_afe_stage_ops_t *ops = wake_sdk_stage_by_id(sdk, id);
    if (ops != nullptr) {
      wake_afe_graph_append(p->graph, ops);
    }
  }

  /* Backend from the registry. */
  p->backend_ops = wake_sdk_backend_by_id(sdk, backend_id);
  if (p->backend_ops == nullptr || p->backend_ops->create == nullptr) {
    wake_afe_graph_destroy(p->graph);
    free(p);
    return nullptr;
  }
  p->backend_impl = p->backend_ops->create(&p->cfg);
  if (p->backend_impl == nullptr) {
    wake_afe_graph_destroy(p->graph);
    free(p);
    return nullptr;
  }
  if (p->backend_ops->load != nullptr &&
      p->backend_ops->load(p->backend_impl, models, &p->cfg) != 0) {
    p->backend_ops->destroy(p->backend_impl);
    wake_afe_graph_destroy(p->graph);
    free(p);
    return nullptr;
  }

  /* One boundary resampler: 48 kHz AFE -> 16 kHz KWS. */
  p->boundary = wake_resampler_create(WAKE_AFE_GRAPH_SAMPLE_RATE_HZ, 16000u);
  if (p->boundary == nullptr) {
    wake_pipeline_destroy(p);
    return nullptr;
  }

  p->smoother = wake_score_smoother_create(p->cfg.smoothing_window_frames);
  p->trigger = wake_trigger_detector_create(&p->cfg, p->backend_ops->label);
  p->gate = wake_vad_gate_create(&p->cfg);
  p->pending_valid = 0;
  if (p->smoother == nullptr || p->trigger == nullptr || p->gate == nullptr) {
    wake_pipeline_destroy(p);
    return nullptr;
  }

  return p;
}

void wake_pipeline_destroy(wake_pipeline_t *p) {
  if (p == nullptr) {
    return;
  }
  if (p->backend_ops != nullptr && p->backend_impl != nullptr) {
    p->backend_ops->destroy(p->backend_impl);
  }
  wake_afe_graph_destroy(p->graph);
  wake_score_smoother_destroy(p->smoother);
  wake_trigger_detector_destroy(p->trigger);
  wake_vad_gate_destroy(p->gate);
  wake_resampler_destroy(p->boundary);
  free(p);
}

int wake_pipeline_process(wake_pipeline_t *p, int16_t *frames, size_t n,
                          double now_ms, wake_score_sample_t *out,
                          wake_trigger_event_t *out_trigger) {
  float vad = 0.0f;
  if (wake_afe_graph_process(p->graph, frames, n, &vad) != 0) {
    return 1;
  }

  /* Downsample once at the KWS boundary so backends keep their 160 @ 16 kHz
   * contract untouched (#245 slice C). */
  if (n != WAKE_AFE_GRAPH_FRAME_SAMPLES) {
    return 1; /* wrong frame size for the AFE-internal rate: refuse loudly */
  }
  size_t produced = 0;
  if (wake_resampler_process(p->boundary, frames, n, p->kws_frame, &produced) !=
          0 ||
      produced != WAKE_SDK_KWS_FRAME_SAMPLES) {
    return 1;
  }
  int16_t *const kws = p->kws_frame;
  const size_t kws_n = produced;

  /* Inference and smoothing ALWAYS run. The VAD gate only decides whether a
   * trigger may be *published* — it never skips inference and never feeds a
   * stale windowed score to the detector (that caused false triggers from a
   * retained peak after silence). */
  const float raw = p->backend_ops->process_frame(p->backend_impl, kws, kws_n);
  const float smooth = wake_score_smoother_push(p->smoother, raw);

  const wake_vad_decision_t decision = wake_vad_gate_step(
      p->gate, wake_afe_graph_has_vad(p->graph), vad, smooth, now_ms);

  wake_trigger_event_t evt;
  memset(&evt, 0, sizeof(evt));
  int fired = wake_trigger_detector_process(p->trigger, smooth, now_ms, &evt);

  if (fired != 0 && decision == WAKE_VAD_HOLD) {
    /* Borderline while the gate is closed: hold the event, bounded by
     * vad_hold_max_ms. The detector has already applied cooldown, so a held
     * event cannot double-fire. */
    p->pending = evt;
    p->pending_valid = 1;
    fired = 0;
  } else if (fired != 0) {
    p->pending_valid = 0;
  } else if (p->pending_valid != 0 &&
             (decision != WAKE_VAD_HOLD ||
              wake_vad_gate_hold_expired(p->gate, now_ms))) {
    /* The gate opened, or the bounded delay ran out: publish now. */
    evt = p->pending;
    p->pending_valid = 0;
    fired = 1;
  }

  if (fired != 0 && out_trigger != nullptr) {
    *out_trigger = evt;
  }

  if (out != nullptr) {
    out->captured_at_ms = now_ms;
    out->raw_score = raw;
    out->smoothed_score = smooth;
    out->triggered = fired;
    out->vad_probability = vad;
  }
  return 0;
}

void wake_pipeline_reset(wake_pipeline_t *p) {
  wake_afe_graph_reset(p->graph);
  wake_resampler_reset(p->boundary);
  if (p->backend_ops != nullptr && p->backend_impl != nullptr) {
    p->backend_ops->reset(p->backend_impl);
  }
  wake_score_smoother_reset(p->smoother);
  wake_trigger_detector_reset(p->trigger);
  wake_vad_gate_reset(p->gate);
  p->pending_valid = 0;
}
