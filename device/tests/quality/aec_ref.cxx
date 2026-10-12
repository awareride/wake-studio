/*
 * aec_ref.cxx — a conforming linear AEC over the wake/aec.h ABI (#249, slice A).
 *
 * This is NOT a competitor for WebRTC AEC3. It is a **NLMS adaptive filter with a
 * bulk-delay estimate**, and it exists for two reasons:
 *
 *  1. It proves the ABI is implementable and specifies it by example, so a real
 *     candidate can be written against something concrete.
 *  2. It gives the harness a *known-behaviour* reference: a linear filter cancels
 *     a linear echo path and does essentially nothing to a nonlinear or time
 *     varying one. If the harness cannot see the difference between this filter
 *     and a deliberately broken one, the harness is not measuring anything.
 *
 * Known limits, deliberately not hidden: single-talk only, no double-talk
 * detector, no comfort noise, linear path only, and it will diverge if the delay
 * hint is wrong by more than the filter length.
 */
#include "wake/aec.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define AEC_MAX_TAPS 512u
#define AEC_DELAY_SLOTS 32 /* up to 32 x 10 ms of bulk delay */

struct wake_aec {
  uint32_t sample_rate_hz;
  uint32_t frame_samples;

  float w[AEC_MAX_TAPS];     /* adaptive filter coefficients */
  float hist[AEC_MAX_TAPS];  /* delayed render */
  unsigned hist_len;

  int16_t delay_buf[AEC_DELAY_SLOTS * WAKE_AEC_FRAME_SAMPLES];
  unsigned delay_frames;
  size_t delay_rd;
  int delay_ms;

  float mu;         /* NLMS step size */
  double leak;      /* coefficient leak, keeps the filter bounded */
  int converged;
  unsigned quiet;   /* frames since the filter last saw excitation */
};

int wake_aec_frame_supported(uint32_t sample_rate_hz, uint32_t frame_samples) {
  return sample_rate_hz == WAKE_AEC_SAMPLE_RATE_HZ &&
                 frame_samples == WAKE_AEC_FRAME_SAMPLES
             ? 1
             : 0;
}

wake_aec_t *wake_aec_create(uint32_t sample_rate_hz, uint32_t frame_samples,
                            uint32_t taps_hint) {
  if (!wake_aec_frame_supported(sample_rate_hz, frame_samples)) {
    return NULL; /* refuse up front rather than resampling silently */
  }
  wake_aec_t *a = (wake_aec_t *)calloc(1, sizeof(wake_aec_t));
  if (a == NULL) {
    return NULL;
  }
  a->sample_rate_hz = sample_rate_hz;
  a->frame_samples = frame_samples;
  a->hist_len = taps_hint > 0 ? (taps_hint > AEC_MAX_TAPS ? AEC_MAX_TAPS : taps_hint)
                              : 256u;
  a->mu = 0.05f;
  a->leak = 1e-6;
  a->delay_ms = 0;
  a->delay_frames = 0;
  a->converged = 0;
  a->quiet = 0;
  return a;
}

void wake_aec_destroy(wake_aec_t *a) { free(a); }

int wake_aec_reset(wake_aec_t *a) {
  if (a == NULL) {
    return 1;
  }
  /* Clear filter STATE only. The contract in wake/aec.h is explicit: "Reset
   * filter state (e.g. on start/stop) without changing configuration."
   *
   * Zeroing hist_len here looks harmless and is not: it is the *configured* tap
   * count, so the next process() computes (hist_len - 1u) with hist_len == 0,
   * which wraps to UINT_MAX and memmoves ~17 GB off the end of the history
   * buffer. Any reset-then-process sequence segfaulted. Configuration lives in
   * create(); reset() leaves it alone. */
  memset(a->w, 0, sizeof(a->w));
  memset(a->hist, 0, sizeof(a->hist));
  memset(a->delay_buf, 0, sizeof(a->delay_buf));
  a->delay_rd = 0;
  a->converged = 0;
  a->quiet = 0;
  return 0;
}

int wake_aec_set_stream_delay_ms(wake_aec_t *a, int delay_ms) {
  if (a == NULL) {
    return 1;
  }
  /* Accept 0..(AEC_DELAY_SLOTS-1) frames. Beyond that we would need a bigger
   * buffer; refusing is better than silently mis-buffering. */
  if (delay_ms < 0) {
    delay_ms = 0;
  }
  const int max_ms = (int)(AEC_DELAY_SLOTS * 10);
  if (delay_ms > max_ms) {
    return 1;
  }
  a->delay_ms = delay_ms;
  a->delay_frames = (unsigned)(delay_ms / 10);
  if ((unsigned)(delay_ms % 10) != 0u) {
    /* Sub-frame delay: not representable in this reference, be explicit. */
    a->delay_frames = 0;
  }
  memset(a->delay_buf, 0, sizeof(a->delay_buf));
  a->delay_rd = 0;
  return 0;
}

/*
 * Circular bulk-delay line: output is the input delayed by `delay_frames`.
 * A ring is the only formulation that both delays correctly and stays O(1) per
 * sample; the previous shift-and-append version could not express "delay by D,
 * overwrite the oldest".
 */
static const int16_t *delayed_render(wake_aec_t *a, const int16_t *render,
                                     int16_t *scratch) {
  const size_t n = a->frame_samples;
  if (a->delay_frames == 0u) {
    return render;
  }
  const size_t len = (size_t)a->delay_frames * n;
  if (len == 0u) {
    return render;
  }
  for (size_t i = 0; i < n; ++i) {
    scratch[i] = a->delay_buf[a->delay_rd];
    a->delay_buf[a->delay_rd] = render[i];
    a->delay_rd = (a->delay_rd + 1u) % len;
  }
  return scratch;
}

int wake_aec_process(wake_aec_t *a, int16_t *capture, const int16_t *render) {
  if (a == NULL || capture == NULL) {
    return 1;
  }
  const size_t n = a->frame_samples;

  /* No playback reference: nothing to cancel. Passing audio through unchanged is
   * the honest behaviour -- inventing attenuation here would be the "mutes the
   * near end" failure this harness exists to catch. */
  if (render == NULL) {
    return 0;
  }

  int16_t scratch[WAKE_AEC_FRAME_SAMPLES];
  const int16_t *ref = delayed_render(a, render, scratch);

  /* Excitation is measured on this frame's delayed render, NOT on the filter
   * history: the history is still empty at this point, and gating on it would
   * short-circuit every frame into pass-through. */
  double ref_e = 0.0;
  for (size_t i = 0; i < n; ++i) {
    const double v = (double)ref[i];
    ref_e += v * v;
  }
  ref_e /= (double)n;

  /* Excitation gate: without render energy there is nothing to adapt to, and
   * dividing by a tiny energy would blow the filter up. */
  if (ref_e < 1.0e-3) {
    ++a->quiet;
    return 0; /* pass through untouched */
  }
  a->quiet = 0;

  for (size_t i = 0; i < n; ++i) {
    /* Push this sample, THEN estimate: the history must end at x[i] for tap k
     * to be lag k. Filling the history with the whole frame up front left the
     * filter looking at samples from the future, which caps ERLE at a few dB
     * no matter how long it converges. */
    memmove(a->hist, a->hist + 1, (a->hist_len - 1u) * sizeof(float));
    a->hist[a->hist_len - 1u] = (float)ref[i];

    /* Estimate the echo from the current weights, subtract it.
     *
     * Tap k is lag k, so the input it sees is x[n-k]. The history is stored
     * oldest-first (hist[hist_len-1] is the newest sample), hence the reversed
     * index. Getting this backwards still compiles and still runs -- it just
     * models a time-reversed impulse response, which is why ERLE came out at
     * 2 dB before this was fixed.
     *
     * `xe` is the tap-vector energy ||x||^2, which the NLMS update below must
     * normalise by. */
    double est = 0.0;
    double xe = 0.0;
    for (unsigned k = 0; k < a->hist_len; ++k) {
      const double x = (double)a->hist[a->hist_len - 1u - k];
      est += (double)a->w[k] * x;
      xe += x * x;
    }
    const double err = (double)capture[i] - est;
    capture[i] = (int16_t)(err > 32767.0 ? 32767.0
                                         : (err < -32768.0 ? -32768.0 : err));

    /* NLMS update, normalised by the tap-vector energy.
     *
     * Normalising by the frame's mean energy instead (the previous version) is
     * not a weaker step size, it is an unstable one: at the start of a frame
     * the history holds only a few samples, so ||x||^2 is orders of magnitude
     * below the frame energy the divisor used. The first estimate then overshoots
     * -- est reached -2e24 within 100 samples and 83 samples clipped to full
     * scale before the filter recovered. Textbook NLMS divides by ||x||^2, which
     * keeps the effective step size bounded regardless of how much history has
     * accumulated. */
    const double norm = xe + 1.0e-6;
    const double step = a->mu * err / norm;
    for (unsigned k = 0; k < a->hist_len; ++k) {
      a->w[k] = (float)((double)a->w[k] +
                        step * a->hist[a->hist_len - 1u - k] -
                        a->leak * a->w[k]);
    }
  }

  /* "Converged" here means: seen enough excitation to have adapted. A real
   * candidate reports a genuine residual-based criterion; this one cannot. */
  if (ref_e > 1.0e3) {
    a->converged = 1;
  }
  return 0;
}

int wake_aec_get_metrics(const wake_aec_t *a, wake_aec_metrics_t *out) {
  if (a == NULL || out == NULL) {
    return 1;
  }
  /* The filter's own view only; the harness computes the real numbers from the
   * known echo path, which is the whole point of having ground truth. */
  out->erle_db = 0.0;
  out->residual_echo_db = 0.0;
  out->near_end_si_sdr_db = 0.0;
  out->delay_ms = (double)a->delay_ms;
  out->converged = a->converged;
  return 0;
}