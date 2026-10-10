/*
 * resample.cxx — integer-ratio sample-rate conversion (wake/resample.h).
 *
 * Upsampling: polyphase interpolation, 12 taps per phase.
 * Downsampling: windowed-sinc anti-alias FIR, then decimate by the ratio.
 *
 * Both directions carry filter history across calls, so a streaming sequence of
 * graph frames has no block-boundary transient. Filter design happens once at
 * creation (no build-time coefficient tables).
 *
 * History layout is **oldest-first** in both directions, which keeps the sample
 * accessors a single expression.
 */
#include "wake/resample.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#include <new>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define UP_TAPS 12u   /* taps per interpolation phase */
#define UP_HIST (UP_TAPS - 1u)
#define DOWN_TAPS 24u /* anti-alias FIR length */
#define DOWN_HIST (DOWN_TAPS - 1u)
#define MAX_RATIO 8u /* covers 16k <-> 48k (ratio 3) with headroom */

/* Anti-alias cutoff as a fraction of the input rate. */
#define CUTOFF_NORM 0.15

struct wake_resampler {
  uint32_t in_rate;
  uint32_t out_rate;
  unsigned ratio; /* out_rate / in_rate */
  int up_mode;     /* 1 = interpolate, 0 = decimate */

  float up_taps[MAX_RATIO * UP_TAPS];
  float down[DOWN_TAPS];

  float up_hist[UP_HIST];    /* oldest-first: [0] = x[-(TAPS-1)] */
  float down_hist[DOWN_HIST]; /* oldest-first */
  size_t down_fill;          /* valid entries in down_hist */
  /*
   * The decimator's history must be *seeded from the stream itself* on the first
   * call. Priming with zeros instead makes the first output block read mostly
   * silence -- measured at ~2% amplitude against a steady-state 71% -- which is
   * an audible dropout at every stream start, not a rounding detail.
   */
  int seeded;
};

static void design_lowpass(float *h, unsigned n, double cutoff) {
  const int d = (int)((n - 1u) / 2u);
  double sum = 0.0;
  for (unsigned i = 0; i < n; ++i) {
    const double x = (double)i - (double)d;
    const double sinc =
        (x == 0.0) ? 2.0 * cutoff : sin(2.0 * M_PI * cutoff * x) / (M_PI * x);
    const double w =
        0.54 - 0.46 * cos(2.0 * M_PI * (double)i / (double)(n - 1u));
    h[i] = (float)(sinc * w);
    sum += h[i];
  }
  if (sum != 0.0) {
    for (unsigned i = 0; i < n; ++i) {
      h[i] = (float)(h[i] / sum);
    }
  }
}

wake_resampler_t *wake_resampler_create(uint32_t in_rate_hz,
                                        uint32_t out_rate_hz) {
  if (in_rate_hz == 0u || out_rate_hz == 0u || in_rate_hz == out_rate_hz) {
    return NULL;
  }
  unsigned ratio;
  int up;
  if (out_rate_hz % in_rate_hz == 0u) {
    up = 1;
    ratio = out_rate_hz / in_rate_hz;
  } else if (in_rate_hz % out_rate_hz == 0u) {
    up = 0;
    ratio = in_rate_hz / out_rate_hz;
  } else {
    return NULL; /* non-integer ratio: refused, never approximated */
  }
  if (ratio > MAX_RATIO) {
    return NULL;
  }

  void *mem = calloc(1, sizeof(wake_resampler_t));
  if (mem == nullptr) {
    return NULL;
  }
  wake_resampler_t *r = new (mem) wake_resampler_t;
  r->in_rate = in_rate_hz;
  r->out_rate = out_rate_hz;
  r->ratio = ratio;
  r->up_mode = up;
  /* Seeded on first use from the incoming samples (see `seeded`). Marked
   * unseeded here so the first process() call establishes the history. */
  r->down_fill = 0;
  r->seeded = 0;

  if (up) {
    float proto[MAX_RATIO * UP_TAPS];
    design_lowpass(proto, ratio * UP_TAPS, 0.5 / (double)ratio);
    for (unsigned p = 0; p < ratio; ++p) {
      double sum = 0.0;
      for (unsigned k = 0; k < UP_TAPS; ++k) {
        r->up_taps[p * UP_TAPS + k] = proto[k * ratio + p];
        sum += r->up_taps[p * UP_TAPS + k];
      }
      /* Per-phase DC normalisation: no level ripple between phases. */
      if (sum != 0.0) {
        for (unsigned k = 0; k < UP_TAPS; ++k) {
          r->up_taps[p * UP_TAPS + k] = (float)(r->up_taps[p * UP_TAPS + k] / sum);
        }
      }
    }
  } else {
    design_lowpass(r->down, DOWN_TAPS, CUTOFF_NORM);
  }
  return r;
}

void wake_resampler_destroy(wake_resampler_t *r) { free(r); }

unsigned wake_resampler_ratio(const wake_resampler_t *r) {
  return r != nullptr ? r->ratio : 1u;
}

void wake_resampler_reset(wake_resampler_t *r) {
  if (r == nullptr) {
    return;
  }
  memset(r->up_hist, 0, sizeof(r->up_hist));
  memset(r->down_hist, 0, sizeof(r->down_hist));
  /* Re-seed from the stream after a reset, exactly as at creation. */
  r->down_fill = 0;
  r->seeded = 0;
}

size_t wake_resampler_capacity(const wake_resampler_t *r, size_t n_in) {
  if (r == nullptr) {
    return 0;
  }
  /* Downsampling retains up to ratio-1 samples of the block. */
  const size_t retain = r->up_mode ? 0u : (size_t)(r->ratio - 1u);
  return (n_in + retain) * (r->up_mode ? (size_t)r->ratio : 1u);
}

/* --- upsampling ---------------------------------------------------------- */

/* x[i] with i possibly negative (served from oldest-first history). */
static float up_at(const wake_resampler_t *r, const int16_t *in, long i) {
  if (i >= 0) {
    return (float)in[i];
  }
  const long hidx = (long)UP_HIST + i; /* i in [-(TAPS-1), -1] -> [0, TAPS-2] */
  if (hidx < 0) {
    return 0.0f;
  }
  return r->up_hist[hidx];
}

static size_t do_up(wake_resampler_t *r, const int16_t *in, size_t n_in,
                    int16_t *out) {
  size_t produced = 0;
  for (size_t i = 0; i < n_in; ++i) {
    for (unsigned p = 0; p < r->ratio; ++p) {
      float acc = 0.0f;
      for (unsigned k = 0; k < UP_TAPS; ++k) {
        acc += r->up_taps[p * UP_TAPS + k] * up_at(r, in, (long)i - (long)k);
      }
      float v = acc;
      if (v > 32767.0f) v = 32767.0f;
      if (v < -32768.0f) v = -32768.0f;
      out[produced++] = (int16_t)v;
    }
  }
  /* New history = the last UP_HIST samples, zero-padded when n_in is short. */
  for (unsigned t = 0; t < UP_HIST; ++t) {
    const long src = (long)n_in - (long)UP_HIST + (long)t;
    r->up_hist[t] = (src >= 0) ? (float)in[src] : 0.0f;
  }
  return produced;
}

/* --- downsampling -------------------------------------------------------- */

/* Sample `i` of the concatenated block [oldest-first history | in]. */
static float down_at(const wake_resampler_t *r, const int16_t *in, size_t hist,
                     long i) {
  if (i < 0) {
    return 0.0f;
  }
  if ((size_t)i < hist) {
    return r->down_hist[i];
  }
  return (float)in[(size_t)i - hist];
}

static size_t do_down(wake_resampler_t *r, const int16_t *in, size_t n_in,
                      int16_t *out) {
  /*
   * Alignment is kept stable across calls by a single rule: the concatenated
   * block always starts at the absolute index of the next output's FIR window.
   * So output `o` reads block[o*ratio .. o*ratio+DOWN_TAPS), and the retained
   * history always starts at `n_out * ratio`. No counter drifts between calls,
   * so no discontinuity can appear at a block boundary.
   */
  /* First call after create/reset: seed the history from the head of the stream
   * so the first output block is full-length and at full amplitude. */
  if (!r->seeded) {
    r->seeded = 1;
    const size_t take = n_in < DOWN_HIST ? n_in : DOWN_HIST;
    for (size_t i = 0; i < take; ++i) {
      r->down_hist[i] = (float)in[i];
    }
    for (size_t i = take; i < DOWN_HIST; ++i) {
      r->down_hist[i] = (float)in[0]; /* degenerate, but n_in is never < 1 here */
    }
    r->down_fill = DOWN_HIST;
  }

  const size_t hist = r->down_fill;
  const size_t total = hist + n_in;
  if (total < DOWN_TAPS) {
    /* Not enough data for even one full window: keep what we have. */
    for (size_t i = 0; i < n_in && r->down_fill < DOWN_HIST; ++i) {
      r->down_hist[r->down_fill++] = (float)in[i];
    }
    return 0;
  }

  const size_t n_out = (total - DOWN_TAPS) / r->ratio + 1u;
  float window[DOWN_TAPS];

  for (size_t o = 0; o < n_out; ++o) {
    const size_t start = o * r->ratio;
    for (unsigned k = 0; k < DOWN_TAPS; ++k) {
      window[k] = down_at(r, in, hist, (long)(start + k));
    }
    float acc = 0.0f;
    for (unsigned k = 0; k < DOWN_TAPS; ++k) {
      acc += r->down[k] * window[k];
    }
    float v = acc;
    if (v > 32767.0f) v = 32767.0f;
    if (v < -32768.0f) v = -32768.0f;
    out[o] = (int16_t)v;
  }

  /* Retain from the next output's window start, so alignment is preserved. */
  const size_t new_base = n_out * r->ratio;
  const size_t keep = total - new_base < DOWN_HIST ? total - new_base : DOWN_HIST;
  /* Copy through a temporary: down_at() reads down_hist, so writing it in place
   * would corrupt the very samples still being read when the new window starts
   * inside the retained region. */
  float tail[DOWN_HIST];
  for (size_t i = 0; i < keep; ++i) {
    tail[i] = down_at(r, in, hist, (long)(new_base + i));
  }
  memcpy(r->down_hist, tail, keep * sizeof(float));
  r->down_fill = keep;
  return n_out;
}

int wake_resampler_process(wake_resampler_t *r, const int16_t *in, size_t n_in,
                           int16_t *out, size_t *n_out) {
  if (r == nullptr || out == nullptr || n_out == nullptr) {
    return 1;
  }
  if (in == nullptr && n_in > 0) {
    return 1;
  }
  *n_out = r->up_mode ? do_up(r, in, n_in, out) : do_down(r, in, n_in, out);
  return 0;
}