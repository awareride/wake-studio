/*
 * wake/detection.h — the generic detection loop (CORE-owned, ADR-018/040).
 *
 * Faithful port of packages/modules/kws/engine/core/logic.ts
 * (ScoreSmoother, TriggerDetector, shouldGateByVad) so the browser demo and
 * the device exports behave identically.
 */
#ifndef WAKE_DETECTION_H
#define WAKE_DETECTION_H

#include <stddef.h>

#include "wake/kws_backend.h"

#ifdef __cplusplus
extern "C" {
#endif

/* --- Score smoother: sliding-window max-pooling ---------------------------- */

typedef struct wake_score_smoother wake_score_smoother_t;

/** Create a smoother with a fixed window size (frames). */
wake_score_smoother_t *wake_score_smoother_create(unsigned window_size);
void wake_score_smoother_destroy(wake_score_smoother_t *s);

/** Push a raw score, return the smoothed (max) score over the window. */
float wake_score_smoother_push(wake_score_smoother_t *s, float raw_score);

/** Whether the buffer has been fully filled at least once. */
int wake_score_smoother_warmed(const wake_score_smoother_t *s);

/** Current max over the window without pushing (for VAD-gated frames). */
float wake_score_smoother_peek(const wake_score_smoother_t *s);

/** Reset the buffer. */
void wake_score_smoother_reset(wake_score_smoother_t *s);

/* --- Trigger detector: threshold + min-duration + cooldown ---------------- */

typedef struct wake_trigger_event {
  double triggered_at_ms;
  float peak_score;
  const char *word;
} wake_trigger_event_t;

typedef struct wake_trigger_detector wake_trigger_detector_t;

/**
 * Create a detector configured from the KWS config (threshold, min duration,
 * cooldown). `word` is borrowed (caller keeps it alive; pass NULL for the
 * default "wake-word").
 */
wake_trigger_detector_t *wake_trigger_detector_create(
    const wake_kws_config_t *cfg, const char *word);
void wake_trigger_detector_destroy(wake_trigger_detector_t *d);

/**
 * Process a smoothed score at the given time (ms). Returns 1 and fills
 * `out` when a trigger fires, 0 otherwise. Semantics identical to the
 * browser TriggerDetector.process(): fires when the score has been >=
 * threshold for >= min_duration_ms continuously, and cooldown_ms has
 * elapsed since the last trigger.
 */
int wake_trigger_detector_process(wake_trigger_detector_t *d,
                                  float smoothed_score, double now_ms,
                                  wake_trigger_event_t *out);

/** Reset internal state (e.g. on stop). */
void wake_trigger_detector_reset(wake_trigger_detector_t *d);

/* --- VAD gate -------------------------------------------------------------- */

/** Returns 1 if the frame should be gated (skipped) by VAD, 0 otherwise. */
int wake_should_gate_by_vad(float vad_probability, float vad_threshold,
                            int gate_enabled);

/*
 * Onset-safe trigger gate (stateful).
 *
 * Contract (ADR-018, fail-open):
 *  1. inference and smoothing ALWAYS run; the gate never skips them;
 *  2. a score >= vad_high_confidence always publishes (WAKE_VAD_BYPASS);
 *  3. while the gate is open, publication is normal (WAKE_VAD_ALLOW);
 *  4. the gate only closes after vad_close_ms of confirmed non-speech
 *     (hysteresis, so word onsets are not clipped);
 *  5. once closed, a borderline trigger is HELD for at most
 *     vad_hold_max_ms (WAKE_VAD_HOLD), then published anyway;
 *  6. no VAD source (vad_available == 0) or a disabled gate means the gate
 *     is permanently open.
 */
typedef struct wake_vad_gate wake_vad_gate_t;

typedef enum wake_vad_decision {
  WAKE_VAD_ALLOW = 0,  /* publish normally */
  WAKE_VAD_BYPASS = 1, /* high confidence: publish regardless of gate state */
  WAKE_VAD_HOLD = 2    /* borderline while closed: delay publication */
} wake_vad_decision_t;

wake_vad_gate_t *wake_vad_gate_create(const wake_kws_config_t *cfg);
void wake_vad_gate_destroy(wake_vad_gate_t *g);
void wake_vad_gate_reset(wake_vad_gate_t *g);

/** Whether gating is switched on at all (config `vad_gate_enabled`). */
int wake_vad_gate_enabled(const wake_vad_gate_t *g);

/** Whether the gate is currently open (fail-open states included). */
int wake_vad_gate_is_open(const wake_vad_gate_t *g);

/**
 * Advance the gate by one frame and return the publication decision.
 * `vad_available` is 0 when no stage in the graph provides a VAD score, which
 * must fail open rather than suppress triggers.
 */
wake_vad_decision_t wake_vad_gate_step(wake_vad_gate_t *g, int vad_available,
                                       float vad_probability,
                                       float smoothed_score, double now_ms);

/** Whether the current hold window has run out (bounded delay, fail open). */
int wake_vad_gate_hold_expired(const wake_vad_gate_t *g, double now_ms);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_DETECTION_H */
