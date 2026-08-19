/*
 * ns_stage.c — RNNoise NS + VAD stage (device target, ADR-021).
 *
 * Mirrors the browser afe/rnnoise engine (core/engine.ts): RNNoise processes
 * 480-sample frames and returns a VAD probability in [0,1]. The AFE graph
 * feeds 160-sample / 10 ms @ 16 kHz frames, so this stage slips 3-in/3-out
 * (30 ms latency), streaming without sample loss.
 *
 * VAD rides this stage (browser parity) — the detection loop reads the VAD
 * probability the graph exposes. A separate VAD module would only be needed
 * for a different VAD source (e.g. Silero), which is out of v1 scope.
 */
#include <stdint.h>
#include <stdlib.h>

#include "rnnoise.h"
#include "wake/afe_graph.h"

#define AFE_FRAME 160u /* 10 ms @ 16 kHz */
#define NS_FRAME 480u  /* rnnoise frame (30 ms @ 16 kHz) */

typedef struct ns_impl {
  DenoiseState *st;
  float in_buf[NS_FRAME];
  float out_buf[NS_FRAME];
  unsigned fill;   /* input accumulation count (0..480) */
  unsigned out_at; /* pending-output drain position */
  int pending;     /* a denoised frame is ready to drain */
  int denoise_enabled;
  float last_vad;
} ns_impl_t;

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
  size_t i;

  /* 1. Save the incoming frame (int16 -> float in rnnoise's scale). */
  for (i = 0; i < n && impl->fill < NS_FRAME; ++i) {
    impl->in_buf[impl->fill++] = (float)frames[i];
  }

  /* 2. Drain a pending denoised frame (streaming, 30 ms latency). */
  if (impl->pending && impl->denoise_enabled) {
    unsigned avail = NS_FRAME - impl->out_at;
    unsigned m = (unsigned)n < avail ? (unsigned)n : avail;
    for (i = 0; i < m; ++i) {
      float v = impl->out_buf[impl->out_at + i];
      if (v > 32767.f) v = 32767.f;
      if (v < -32768.f) v = -32768.f;
      frames[i] = (int16_t)v;
    }
    impl->out_at += m;
    if (impl->out_at >= NS_FRAME) {
      impl->pending = 0;
      impl->out_at = 0;
    }
  }

  /* 3. When a full frame is buffered (and not holding one), run RNNoise. */
  if (impl->fill == NS_FRAME && (!impl->pending || !impl->denoise_enabled)) {
    impl->last_vad = rnnoise_process_frame(impl->st, impl->out_buf,
                                           impl->in_buf);
    impl->pending = impl->denoise_enabled; /* only buffer output when denoising */
    impl->out_at = 0;
    impl->fill = 0;
  }

  if (vad_out != NULL) {
    *vad_out = impl->last_vad;
  }
  return 0;
}

static void ns_reset(void *v) {
  ns_impl_t *impl = (ns_impl_t *)v;
  impl->fill = 0;
  impl->out_at = 0;
  impl->pending = 0;
  impl->last_vad = 0.0f;
  rnnoise_destroy(impl->st);
  impl->st = rnnoise_create(NULL);
}

const wake_afe_stage_ops_t wake_afe_ns_ops = {
    "ns", "RNNoise noise suppression + VAD", ns_create, ns_destroy, ns_process,
    ns_reset};
