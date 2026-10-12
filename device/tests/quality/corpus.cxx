/*
 * corpus.cxx — deterministic synthetic corpus (wake_corpus_render).
 *
 * Pure, allocation-free and platform-independent: only integer/LCG-driven
 * arithmetic, so the same parameters give the same samples on gcc, clang, a
 * Cortex-M cross build and a laptop. That reproducibility is the whole point --
 * it is what lets the harness gate on a threshold instead of printing a number
 * nobody can reproduce.
 */
#include "corpus.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static const double kSampleRate = 48000.0;

void wake_corpus_rng_seed(wake_corpus_rng_t *rng, uint32_t seed) {
  rng->state = seed != 0u ? seed : 1u;
}

float wake_corpus_noise(wake_corpus_rng_t *rng) {
  /* Numerical Recipes LCG; the top bits are the well-mixed ones. */
  rng->state = rng->state * 1664525u + 1013904223u;
  const int32_t v = (int32_t)(rng->state >> 8) - 0x00800000; /* 24-bit signed */
  return (float)((double)v / 8388608.0);
}

/* One-pole low-passed white noise: a cheap, stable pink-ish source. */
static void pink_fill(float *buf, size_t n, wake_corpus_rng_t *rng, float alpha) {
  float y = 0.0f;
  for (size_t i = 0; i < n; ++i) {
    y = alpha * y + (1.0f - alpha) * wake_corpus_noise(rng);
    buf[i] = y;
  }
}

/*
 * A synthetic exponentially-decaying RIR: noise shaped by exp(-t/tau) and, for a
 * plausible early-reflection pattern, a few discrete taps. This is not a measured
 * room, and the harness does not pretend it is -- it is a *reproducible* impulse
 * response, which is what lets a reverberation metric be compared across builds.
 */
static void render_rir(float *rir, size_t n, wake_corpus_rng_t *rng, float rt60) {
  const double tau = rt60 > 0.0f ? (double)rt60 / 6.90775527898214 : 1e-6;
  for (size_t i = 0; i < n; ++i) {
    const double t = (double)i / kSampleRate;
    rir[i] = (float)(wake_corpus_noise(rng) * exp(-t / tau));
  }
  rir[0] += 1.0f; /* direct path */
  if (n > 40) {
    rir[20] += 0.35f; /* early reflections */
  }
  if (n > 90) {
    rir[85] -= 0.20f;
  }
}

static void convolve(const float *x, size_t n, const float *h, size_t hn,
                     float *y) {
  for (size_t i = 0; i < n; ++i) {
    double acc = 0.0;
    const size_t limit = (i + 1 < hn) ? (i + 1) : hn;
    for (size_t k = 0; k < limit; ++k) {
      acc += (double)x[i - k] * (double)h[k];
    }
    y[i] = (float)acc;
  }
}

static void scale_to_peak(float *buf, size_t n, float peak) {
  float m = 0.0f;
  for (size_t i = 0; i < n; ++i) {
    const float a = buf[i] < 0.0f ? -buf[i] : buf[i];
    if (a > m) {
      m = a;
    }
  }
  if (m <= 0.0f) {
    return;
  }
  const float g = peak / m;
  for (size_t i = 0; i < n; ++i) {
    buf[i] *= g;
  }
}

static int16_t to_i16(float v);

/* --- shared rendering internals ------------------------------------------ */

static void render_noise_float(float *noise, size_t n, wake_corpus_rng_t *rng) {
  pink_fill(noise, n, rng, 0.97f);
  scale_to_peak(noise, n, 0.5f);
}

static void render_clean_float(float *signal, size_t n, wake_corpus_kind_t kind,
                               wake_corpus_rng_t *rng, float freq_hz,
                               float rt60_s) {
  const float f = freq_hz > 0.0f ? freq_hz : 440.0f;
  for (size_t i = 0; i < n; ++i) {
    const double t = (double)i / kSampleRate;
    signal[i] = (float)(0.5 * sin(2.0 * M_PI * f * t));
  }
  scale_to_peak(signal, n, 0.5f);
  if (kind == WAKE_CORPUS_REVERB_TONE) {
    const size_t hn = n / 4;
    float *rir = (float *)calloc(hn, sizeof(float));
    if (rir == NULL) {
      return;
    }
    render_rir(rir, hn, rng, rt60_s);
    float *wet = (float *)calloc(n, sizeof(float));
    if (wet != NULL) {
      convolve(signal, n, rir, hn, wet);
      scale_to_peak(wet, n, 0.5f);
      memcpy(signal, wet, n * sizeof(float));
      free(wet);
    }
    free(rir);
  }
}

/* Add the noise at the requested SNR relative to the clean signal's RMS. */
static void mix_at_snr(float *signal, const float *noise, size_t n,
                       float snr_db) {
  double sr = 0.0, nr = 0.0;
  for (size_t i = 0; i < n; ++i) {
    sr += (double)signal[i] * signal[i];
    nr += (double)noise[i] * noise[i];
  }
  sr = sqrt(sr / (double)n);
  nr = sqrt(nr / (double)n);
  const double target = sr * pow(10.0, -(double)snr_db / 20.0);
  const double g = nr > 1e-12 ? target / nr : 0.0;
  for (size_t i = 0; i < n; ++i) {
    signal[i] += (float)(g * noise[i]);
  }
}

static int16_t to_i16(float v) {
  if (v > 32767.0f) return 32767;
  if (v < -32768.0f) return -32768;
  return (int16_t)v;
}

/* Shared internals so the clean / noise / mixed renderings agree sample for
 * sample on the same seed. */
static void render_clean_float(float *signal, size_t n,
                               wake_corpus_kind_t kind, wake_corpus_rng_t *rng,
                               float freq_hz, float rt60_s);
static void render_noise_float(float *noise, size_t n, wake_corpus_rng_t *rng);
static void mix_at_snr(float *signal, const float *noise, size_t n,
                       float snr_db);

void wake_corpus_render_clean(int16_t *out, size_t n, wake_corpus_kind_t kind,
                              uint32_t seed, float snr_db, float freq_hz,
                              float rt60_s) {
  (void)seed;  /* clean has no noise, so the seed only seeds the RIR */
  if (out == NULL || n == 0) {
    return;
  }
  float *signal = (float *)calloc(n, sizeof(float));
  if (signal == NULL) {
    return;
  }
  wake_corpus_rng_t rng;
  wake_corpus_rng_seed(&rng, seed);
  render_clean_float(signal, n, kind, &rng, freq_hz, rt60_s);
  for (size_t i = 0; i < n; ++i) {
    out[i] = to_i16(signal[i] * 32767.0f);
  }
  free(signal);
}

void wake_corpus_render_noise(int16_t *out, size_t n, wake_corpus_kind_t kind,
                              uint32_t seed, float snr_db, float freq_hz,
                              float rt60_s) {
  (void)kind;   /* the noise realisation depends on the seed only */
  (void)snr_db; /* its level is applied by the mix, not by this rendering */
  (void)freq_hz;
  (void)rt60_s;
  if (out == NULL || n == 0) {
    return;
  }
  float *noise = (float *)calloc(n, sizeof(float));
  if (noise == NULL) {
    return;
  }
  wake_corpus_rng_t rng;
  wake_corpus_rng_seed(&rng, seed);
  render_noise_float(noise, n, &rng);
  /* Same normalisation as the noise actually added to a signal clip. */
  scale_to_peak(noise, n, 0.5f);
  for (size_t i = 0; i < n; ++i) {
    out[i] = to_i16(noise[i] * 32767.0f);
  }
  free(noise);
}

void wake_corpus_render(int16_t *out, size_t n, wake_corpus_kind_t kind,
                        uint32_t seed, float snr_db, float freq_hz,
                        float rt60_s) {
  if (out == NULL || n == 0) {
    return;
  }
  wake_corpus_rng_t rng;
  wake_corpus_rng_seed(&rng, seed);

  float *signal = (float *)calloc(n, sizeof(float));
  float *noise = (float *)calloc(n, sizeof(float));
  if (signal == NULL || noise == NULL) {
    free(signal);
    free(noise);
    return;
  }

  const float f = freq_hz > 0.0f ? freq_hz : 440.0f;

  switch (kind) {
    case WAKE_CORPUS_NOISE: {
      /* Pink-ish: a one-pole shaping filter, not white. */
      render_noise_float(noise, n, &rng);
      scale_to_peak(noise, n, 0.5f);
      memcpy(signal, noise, n * sizeof(float));
      break;
    }
    case WAKE_CORPUS_REVERB_TONE: {
      for (size_t i = 0; i < n; ++i) {
        const double t = (double)i / kSampleRate;
        signal[i] = (float)(0.5 * sin(2.0 * M_PI * f * t));
      }
      scale_to_peak(signal, n, 0.5f);
      const size_t hn = n / 4;
      float *rir = (float *)calloc(hn, sizeof(float));
      if (rir != NULL) {
        render_rir(rir, hn, &rng, rt60_s);
        float *wet = (float *)calloc(n, sizeof(float));
        if (wet != NULL) {
          convolve(signal, n, rir, hn, wet);
          scale_to_peak(wet, n, 0.5f);
          memcpy(signal, wet, n * sizeof(float));
          free(wet);
        }
        free(rir);
      }
      break;
    }
    case WAKE_CORPUS_TONE:
    case WAKE_CORPUS_TONE_NOISE:
    default: {
      for (size_t i = 0; i < n; ++i) {
        const double t = (double)i / kSampleRate;
        signal[i] = (float)(0.5 * sin(2.0 * M_PI * f * t));
      }
      scale_to_peak(signal, n, 0.5f);
      if (kind == WAKE_CORPUS_TONE_NOISE) {
        render_noise_float(noise, n, &rng);
        mix_at_snr(signal, noise, n, snr_db);
        scale_to_peak(signal, n, 0.9f);
      }
      break;
    }
  }

  for (size_t i = 0; i < n; ++i) {
    out[i] = to_i16(signal[i] * 32767.0f);
  }
  free(signal);
  free(noise);
}

/* --- paired echo material (#249) ------------------------------------------ */

/*
 * A far-end playback signal and the microphone signal it would produce through a
 * known echo path. The path is a bulk delay plus a short exponentially-decaying
 * RIR at a fixed gain, so the ground truth echo is computable and the metrics are
 * well-posed.
 *
 * The far end is BROADBAND (seeded pink noise), not a tone stack. This matters
 * more than it looks: a periodic far end correlates 0.90 with itself at a 100 ms
 * lag, and a short FIR can "align" a periodic signal with a fractional delay.
 * With a tone-stack far end, ERLE stayed above 15 dB even with a 20 ms delay
 * error -- the metric could not tell a correct AEC from a misaligned one, and the
 * known-bad negative control passed on ERLE. Broadband excitation is what makes
 * ERLE mean "this AEC modelled the echo path" rather than "this AEC found the
 * period of the test tone".
 */
void wake_corpus_render_echo_pair(int16_t *render, int16_t *capture,
                                  int16_t *near_end_out, size_t n,
                                  wake_corpus_echo_kind_t kind,
                                  const wake_corpus_echo_path_t *path,
                                  float near_end_freq_hz, float noise_snr_db) {
  if (render == NULL || capture == NULL || n == 0 || path == NULL) {
    return;
  }

  float *far = (float *)calloc(n, sizeof(float));
  float *echo = (float *)calloc(n, sizeof(float));
  float *near = (float *)calloc(n, sizeof(float));
  if (far == NULL || echo == NULL || near == NULL) {
    free(far);
    free(echo);
    free(near);
    return;
  }

  /* Far end: seeded pink noise. Deterministic per seed, so the corpus stays
   * bit-reproducible (corpus.h) while spanning the band an AEC must adapt in. */
  {
    wake_corpus_rng_t rng;
    wake_corpus_rng_seed(&rng, path->seed ^ 0xf0f0f0f0u);
    pink_fill(far, n, &rng, 0.92f);
  }
  scale_to_peak(far, n, 0.5f);

  /* Echo path: RIR at a fixed gain, then a bulk delay of `delay_frames`. */
  const size_t hn = path->path_length > 0 ? (size_t)path->path_length : 1u;
  float *rir = (float *)calloc(hn, sizeof(float));
  if (rir != NULL) {
    wake_corpus_rng_t rng;
    wake_corpus_rng_seed(&rng, path->seed);
    const double tau = 0.0025; /* ~2.5 ms decay: a plausible small room */
    for (size_t i = 0; i < hn; ++i) {
      const double t = (double)i / kSampleRate;
      rir[i] = (float)(wake_corpus_noise(&rng) * exp(-t / tau));
    }
    rir[0] += 1.0f; /* direct reflection dominates */
    for (size_t i = 0; i < hn; ++i) {
      rir[i] *= path->echo_gain;
    }
    convolve(far, n, rir, hn, echo);
    free(rir);
  }

  const size_t delay =
      path->delay_frames > 0 ? (size_t)path->delay_frames * 480u : 0u;

  /*
   * Near end, rendered as its OWN buffer and then summed into the microphone.
   *
   * The harness needs this exact signal to score near-end survival (SI-SDR). The
   * previous version had the caller reconstruct it by re-running the generator in
   * a different mode -- which silently produced the ECHO, not the near end, so
   * the gate was scoring the wrong quantity (a perfect AEC failed it at -55 dB).
   * Ground truth must be a thing the generator hands over, not something the
   * caller re-derives and hopes matches.
   */
  if (kind == WAKE_ECHO_DOUBLE_TALK) {
    const double t_step = 1.0 / kSampleRate;
    for (size_t i = 0; i < n; ++i) {
      const double t = (double)i * t_step;
      const float f = near_end_freq_hz > 0.0f ? near_end_freq_hz : 440.0f;
      near[i] = (float)(0.25 * sin(2.0 * M_PI * f * t));
    }
  }

  /* Microphone: the delayed echo, plus the near-end signal when double talking. */
  wake_corpus_rng_t rng;
  wake_corpus_rng_seed(&rng, path->seed ^ 0x5eed5eedu);
  for (size_t i = 0; i < n; ++i) {
    float mic = 0.0f;
    if (i >= delay) {
      mic = echo[i - delay];
    }
    mic += near[i];
    mic += (float)(0.02 * wake_corpus_noise(&rng)); /* mic self-noise floor */
    capture[i] = to_i16(mic * 32767.0f);
    if (near_end_out != NULL) {
      near_end_out[i] = to_i16(near[i] * 32767.0f);
    }
  }
  (void)noise_snr_db; /* a fixed self-noise floor is enough for slice A */

  for (size_t i = 0; i < n; ++i) {
    render[i] = to_i16(far[i] * 32767.0f);
  }
  free(far);
  free(echo);
  free(near);
}
