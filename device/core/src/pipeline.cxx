/*
 * pipeline.cxx — the per-pipeline runtime (ADR-018).
 */
#include "wake/pipeline.h"

#include <stdlib.h>
#include <string.h>
#include <new>

#include "wake/afe_graph.h"

struct wake_pipeline {
  wake_afe_graph_t *graph;
  const wake_kws_backend_ops_t *backend_ops;
  void *backend_impl;
  wake_score_smoother_t *smoother;
  wake_trigger_detector_t *trigger;
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

  p->cfg = cfg ? *cfg : wake_kws_config_t{0.5f, 300u, 5u, 1, 0.3f, 2000u};
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

  p->smoother = wake_score_smoother_create(p->cfg.smoothing_window_frames);
  p->trigger = wake_trigger_detector_create(&p->cfg, p->backend_ops->label);
  if (p->smoother == nullptr || p->trigger == nullptr) {
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
  free(p);
}

int wake_pipeline_process(wake_pipeline_t *p, int16_t *frames, size_t n,
                          double now_ms, wake_score_sample_t *out,
                          wake_trigger_event_t *out_trigger) {
  float vad = 0.0f;
  if (wake_afe_graph_process(p->graph, frames, n, &vad) != 0) {
    return 1;
  }

  /* VAD gate: gated frames skip inference and do not push into the smoother
   * window (max-pooling keeps the recent peak, browser parity). */
  const int gated =
      wake_should_gate_by_vad(vad, p->cfg.vad_threshold, p->cfg.vad_gate_enabled);

  float raw = 0.0f;
  float smooth = 0.0f;
  if (!gated) {
    raw = p->backend_ops->process_frame(p->backend_impl, frames, n);
    smooth = wake_score_smoother_push(p->smoother, raw);
  } else {
    smooth = wake_score_smoother_peek(p->smoother);
  }

  int triggered =
      wake_trigger_detector_process(p->trigger, smooth, now_ms, out_trigger);

  if (out != nullptr) {
    out->captured_at_ms = now_ms;
    out->raw_score = raw;
    out->smoothed_score = smooth;
    out->triggered = triggered;
    out->vad_probability = vad;
  }
  return 0;
}

void wake_pipeline_reset(wake_pipeline_t *p) {
  wake_afe_graph_reset(p->graph);
  if (p->backend_ops != nullptr && p->backend_impl != nullptr) {
    p->backend_ops->reset(p->backend_impl);
  }
  wake_score_smoother_reset(p->smoother);
  wake_trigger_detector_reset(p->trigger);
}
