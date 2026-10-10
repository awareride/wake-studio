/*
 * ns_stage.c — RNNoise NS + VAD stage (device target, ADR-021).
 *
 * Sample-rate contract (issue #241 B2): RNNoise is a 48 kHz model whose API
 * takes exactly 480 samples (10 ms @ 48 kHz). The device AFE graph runs at
 * 16 kHz / 160-sample frames, so this stage owns the rate conversion, one
 * model call per graph frame:
 *
 *   160 x 16 kHz  ->  (polyphase x3 interpolate)  ->  480 x 48 kHz
 *                  ->  rnnoise_process_frame       ->  480 x 48 kHz
 *                  ->  (FIR low-pass + decimate)   ->  160 x 16 kHz
 *
 * Before this fix the stage buffered 3 graph frames and pushed 480 samples of
 * 16 kHz audio straight into the 48 kHz model, describing it as "30 ms @ 16
 * kHz". That is not a quality regression, it is a correctness bug: digital
 * silence came out of the stage with an RMS high enough to cross the trigger
 * threshold, and the model's VAD reported speech probability on silence.
 *
 * This mirrors the browser, which runs its AFE chain at 48 kHz internally
 * (packages/modules/afe/graph/web) and downsamples to 16 kHz before the KWS.
 * Keeping the graph at 16 kHz and converting here preserves the existing
 * 160-sample stage/backend contract; unifying the device graph at 48 kHz is
 * tracked separately as the wider AFE redesign.
 *
 * VAD rides this stage (browser parity) — the detection loop reads the VAD
 * probability the graph exposes. A separate VAD module would only be needed
 * for a different VAD source (e.g. Silero / WebRTC VAD), out of v1 scope.
 */
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "rnnoise.h"
#include "wake/afe_graph.h"

#define AFE_FRAME 160u /* 10 ms @ 16 kHz — one AFE graph frame */
#define NS_FRAME 480u  /* rnnoise frame (10 ms @ 48 kHz) */
#define UP_FACTOR 3u   /* 16 kHz -> 48 kHz */
#define UP_TAPS 12u    /* per interpolation phase (prototype = 36 taps) */
#define DOWN_TAPS 24u  /* anti-alias FIR before decimating by 3 */

/* Anti-alias cutoff as a fraction of the 48 kHz sample rate: 0.15 ~= 7.2 kHz,
 * just under the 8 kHz Nyquist of the 16 kHz graph. */
#define CUTOFF_NORM 0.15

typedef struct ns_impl {
  DenoiseState *st;
  float up_buf[NS_FRAME];  /* 480 @ 48 kHz, model input */
  float out_buf[NS_FRAME]; /* 480 @ 48 kHz, model output */
  /* Interpolator history: hist[0] = x[-1], hist[1] = x[-2], ... */
  float hist[UP_TAPS - 1u];
  /* Filter banks, designed once in ns_create (no build-time tables). */
  float up[UP_FACTOR * UP_TAPS];
  float down[DOWN_TAPS];
  int denoise_enabled;
  float last_vad;
} ns_impl_t;

/* --- filter design --------------------------------------------------------- */

/* Windowed-sinc (Hamming) low-pass prototype, normalised to unity DC gain. */
static void design_lowpass(float *h, unsigned n, double cutoff) {
  const int d = (int)((n - 1u) / 2u);
  double sum = 0.0;
  for (unsigned i = 0; i < n; ++i) {
    const double x = (double)i - (double)d;
    double sinc;
    if (x == 0.0) {
      sinc = 2.0 * cutoff;
    } else {
      sinc = sin(2.0 * M_PI * cutoff * x) / (M_PI * x);
    }
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

static void design_filters(ns_impl_t *impl) {
  float proto[UP_FACTOR * UP_TAPS];
  design_lowpass(proto, UP_FACTOR * UP_TAPS, 0.5 / (double)UP_FACTOR);
  /* Polyphase split; normalise every phase to unity DC gain so the
   * interpolator introduces no level ripple between phases. */
  for (unsigned p = 0; p < UP_FACTOR; ++p) {
    double sum = 0.0;
    for (unsigned k = 0; k < UP_TAPS; ++k) {
      impl->up[p * UP_TAPS + k] = proto[k * UP_FACTOR + p];
      sum += impl->up[p * UP_TAPS + k];
    }
    if (sum != 0.0) {
      for (unsigned k = 0; k < UP_TAPS; ++k) {
        impl->up[p * UP_TAPS + k] = (float)(impl->up[p * UP_TAPS + k] / sum);
      }
    }
  }
  design_lowpass(impl->down, DOWN_TAPS, CUTOFF_NORM);
}

/* --- rate conversion ------------------------------------------------------- */

/* x[j] with j possibly negative (served from the filter history). */
static float tap_at(const ns_impl_t *impl, const int16_t *in, int i, int k) {
  const int j = i - (int)k;
  if (j >= 0) {
    return (float)in[j];
  }
  const int hidx = (int)(UP_TAPS - 1u) + j; /* j in [-(T-1), -1] */
  if (hidx < 0) {
    return 0.0f;
  }
  return impl->hist[hidx];
}

/* AFE_FRAME x 16 kHz -> NS_FRAME x 48 kHz (3x polyphase interpolation). */
static void interpolate(const ns_impl_t *impl, const int16_t *in, float *out) {
  for (unsigned i = 0; i < AFE_FRAME; ++i) {
    for (unsigned p = 0; p < UP_FACTOR; ++p) {
      float acc = 0.0f;
      for (unsigned k = 0; k < UP_TAPS; ++k) {
        acc += impl->up[p * UP_TAPS + k] * tap_at(impl, in, (int)i, (int)k);
      }
      out[i * UP_FACTOR + p] = acc;
    }
  }
}

/* NS_FRAME x 48 kHz -> AFE_FRAME x 16 kHz (anti-alias FIR + decimate by 3). */
static void decimate(const ns_impl_t *impl, const float *in, int16_t *out) {
  const int d = (int)((DOWN_TAPS - 1u) / 2u);
  for (unsigned i = 0; i < AFE_FRAME; ++i) {
    float acc = 0.0f;
    for (unsigned k = 0; k < DOWN_TAPS; ++k) {
      int j = (int)(i * UP_FACTOR) + (int)k - d;
      if (j < 0) {
        j = 0; /* edge of the 10 ms block: sub-sample transient */
      } else if (j >= (int)NS_FRAME) {
        j = (int)NS_FRAME - 1;
      }
      acc += impl->down[k] * in[j];
    }
    float v = acc;
    if (v > 32767.0f) v = 32767.0f;
    if (v < -32768.0f) v = -32768.0f;
    out[i] = (int16_t)v;
  }
}

/* --- stage ops ------------------------------------------------------------- */

static void *ns_create(void) {
  ns_impl_t *impl = (ns_impl_t *)calloc(1, sizeof(ns_impl_t));
  if (impl == NULL) {
    return NULL;
  }
  impl->st = rnnoise_create(NULL); /* default built-in model */
  if (impl->st == NULL) {
    free(impl);
    return NULL;
  }
  design_filters(impl);
  impl->denoise_enabled = 1;
  return impl;
}

static void ns_destroy(void *v) {
  ns_impl_t *impl = (ns_impl_t *)v;
  if (impl == NULL) {
    return;
  }
  if (impl->st != NULL) {
    rnnoise_destroy(impl->st);
  }
  free(impl);
}

static int ns_process(void *v, int16_t *frames, size_t n, float *vad_out) {
  ns_impl_t *impl = (ns_impl_t *)v;

  if (impl->denoise_enabled) {
    /* The AFE graph contract is one 10 ms frame (160 samples @ 16 kHz) per
     * call, i.e. exactly one RNNoise frame per call. A trailing partial frame
     * is passed through untouched rather than rate-converted from a
     * zero-padded tail. */
    size_t offset = 0;
    while (n - offset >= AFE_FRAME) {
      int16_t *chunk = frames + offset;
      interpolate(impl, chunk, impl->up_buf);
      impl->last_vad =
          rnnoise_process_frame(impl->st, impl->out_buf, impl->up_buf);
      decimate(impl, impl->out_buf, chunk);
      /* Carry the interpolator history across frame boundaries so the filter
       * does not restart every 10 ms. */
      for (unsigned t = 0; t + 1u < UP_TAPS; ++t) {
        impl->hist[t] = (float)chunk[AFE_FRAME - (UP_TAPS - 1u) + t];
      }
      offset += AFE_FRAME;
    }
  }

  if (vad_out != NULL) {
    *vad_out = impl->last_vad;
  }
  return 0;
}

static void ns_reset(void *v) {
  ns_impl_t *impl = (ns_impl_t *)v;
  impl->last_vad = 0.0f;
  memset(impl->hist, 0, sizeof(impl->hist));
  rnnoise_destroy(impl->st);
  impl->st = rnnoise_create(NULL);
}

const wake_afe_stage_ops_t wake_afe_ns_ops = {
    "ns", "RNNoise noise suppression + VAD", ns_create, ns_destroy, ns_process,
    ns_reset, 1 /* provides_vad */};