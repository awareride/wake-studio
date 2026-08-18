/*
 * wake/pipeline.h — the per-pipeline runtime: AFE graph → KWS backend →
 * detection loop (ADR-018/021). The same object a demo or a language binding
 * drives, mirroring the browser's score/trigger event shapes.
 */
#ifndef WAKE_PIPELINE_H
#define WAKE_PIPELINE_H

#include <stddef.h>
#include <stdint.h>

#include "wake/detection.h"
#include "wake/kws_backend.h"
#include "wake/sdk.h"

#ifdef __cplusplus
extern "C" {
#endif

/* One score sample emitted per frame — mirrors the browser KWSScoreSample. */
typedef struct wake_score_sample {
  double captured_at_ms;
  float raw_score;      /* model posterior [0,1] (0 when VAD-gated) */
  float smoothed_score; /* sliding-window max */
  int triggered;
  float vad_probability;
} wake_score_sample_t;

typedef struct wake_pipeline wake_pipeline_t;

/**
 * Create a pipeline: builds the AFE graph from the stages registered on the
 * SDK (ADR-001 order: aec → bss → ns), creates the named backend, and wires
 * the detection loop (smoothing, VAD gate, threshold + min-duration +
 * cooldown). `models` may be NULL for backends that need no model files
 * (e.g. the host RMS reference backend).
 */
wake_pipeline_t *wake_pipeline_create(wake_sdk_t *sdk, const char *backend_id,
                                      const wake_kws_config_t *cfg,
                                      const wake_model_bundle_t *models);

void wake_pipeline_destroy(wake_pipeline_t *p);

/**
 * Feed one 10 ms frame (160 samples @ 16 kHz) at the given time (ms —
 * caller-provided clock, e.g. frame_index * 10).
 *
 * VAD-gated frames skip inference and do not push into the smoother window
 * (max-pooling keeps the recent peak, browser parity). Fills `out` (may be
 * NULL) and, when a trigger fires, `out_trigger`. Returns 0 on success.
 */
int wake_pipeline_process(wake_pipeline_t *p, int16_t *frames, size_t n,
                          double now_ms, wake_score_sample_t *out,
                          wake_trigger_event_t *out_trigger);

/** Reset graph, backend, smoother and detector (e.g. on stop). */
void wake_pipeline_reset(wake_pipeline_t *p);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_PIPELINE_H */
