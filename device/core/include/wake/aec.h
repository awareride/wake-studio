/*
 * wake/aec.h — the AEC C ABI (issue #249).
 *
 * This is the seam every AEC candidate must present: a pinned upstream AEC3
 * behind an opaque handle, the same as a WASM port, a learned model, or the
 * linear reference used to validate this harness. The device stage contract
 * (wake/afe_graph.h) can therefore wrap any of them without changing.
 *
 * Two streams, deliberately separate, because conflating them is the classic AEC
 * integration bug:
 *   - `render`   : the far-end playback signal (loudspeaker);
 *   - `capture`  : the near-end microphone signal.
 * The implementation owns one instance of both for its lifetime; frames are
 * pushed in matching 10 ms blocks.
 *
 * All functions return 0 on success. Audio is int16 at the graph's internal rate
 * (48 kHz, 480 samples per frame, #245); a candidate that only supports another
 * rate must say so via capability reporting rather than resampling silently.
 *
 * This header is a contract, not an implementation. Ship nothing against it
 * without the qualification steps in docs/modules/afe.md (capture qualification,
 * then the quality harness, then double-talk listening tests).
 */
#ifndef WAKE_AEC_H
#define WAKE_AEC_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Samples per frame this ABI is defined for: 10 ms at 48 kHz. */
#define WAKE_AEC_FRAME_SAMPLES 480u
#define WAKE_AEC_SAMPLE_RATE_HZ 48000u

/* Reported metrics, all in dB unless stated. Filled by wake_aec_get_metrics(). */
typedef struct wake_aec_metrics {
  double erle_db;          /* echo return loss enhancement, far-end only */
  double residual_echo_db; /* residual echo level relative to the render */
  double near_end_si_sdr_db; /* near-end speech quality under double talk */
  double delay_ms;         /* the delay estimate currently in use */
  int converged;           /* non-zero once the filter has settled */
} wake_aec_metrics_t;

/* Capability probe, so an unsupported rate/frame can be refused up front. */
int wake_aec_frame_supported(uint32_t sample_rate_hz, uint32_t frame_samples);

typedef struct wake_aec wake_aec_t;

/**
 * Create an instance. `taps_hint` (0 = implementation default) is a hint only:
 * a candidate may clamp it, and must not fail the call for a different value.
 */
wake_aec_t *wake_aec_create(uint32_t sample_rate_hz, uint32_t frame_samples,
                            uint32_t taps_hint);

void wake_aec_destroy(wake_aec_t *aec);

/** Reset filter state (e.g. on start/stop) without changing configuration. */
int wake_aec_reset(wake_aec_t *aec);

/**
 * Tell the implementation the echo path delay. Wrong values are the classic cause
 * of "AEC does nothing": the candidate must adapt around it, not require it.
 */
int wake_aec_set_stream_delay_ms(wake_aec_t *aec, int delay_ms);

/**
 * Process one frame pair in place. `capture` is modified (echo removed);
 * `render` is read-only. Either may be NULL: a NULL `render` means "no playback
 * reference", which is legitimate (and disables cancellation).
 */
int wake_aec_process(wake_aec_t *aec, int16_t *capture, const int16_t *render);

int wake_aec_get_metrics(const wake_aec_t *aec, wake_aec_metrics_t *out);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_AEC_H */