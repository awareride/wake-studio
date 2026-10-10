/*
 * ns_stage.c — RNNoise NS + VAD stage (device target, ADR-021).
 *
 * Sample-rate contract (issue #245 slice A, after #240 B2):
 *
 * RNNoise is a 48 kHz model whose API takes exactly 480 samples (10 ms @ 48
 * kHz). The device AFE graph runs at a different rate, so this stage **declares**
 * `NS_SAMPLE_RATE` / `NS_FRAME` in its `wake_afe_stage_ops_t` and the graph
 * converts to and from that rate centrally (`wake/resample.h`).
 *
 * History, because this contract is exactly what went wrong before:
 * - the stage used to buffer three graph frames and push 480 samples of 16 kHz
 *   audio into the 48 kHz model, calling it "30 ms @ 16 kHz". Digital silence
 *   came out of the stage above the trigger threshold and the VAD reported
 *   speech on silence (#240 B2, fixed in #244 by converting here);
 * - that fix was correct but kept the conversion *inside the module*. An
 *   implicit, per-stage, untested assumption is precisely how the bug shipped.
 *   Declaring the rate makes the mismatch structural and puts the conversion,
 *   and its tests, in the core.
 *
 * The browser already runs its AFE chain at 48 kHz internally
 * (packages/modules/afe/graph/web, docs/modules/afe.md §4) and downsamples to
 * 16 kHz before the KWS, so after this change the device and the browser agree
 * on the AFE-internal rate. Moving the device graph itself to 48 kHz is the
 * remaining step (#245 slice B) and is not attempted here.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "rnnoise.h"
#include "wake/afe_graph.h"
#include "wake/resample.h"

/*
 * RNNoise is a 48 kHz / 480-sample model. This stage therefore DECLARES a
 * 48 kHz, 480-sample frame in `wake_afe_stage_ops_t`, and the AFE graph owns
 * the conversion to and from the graph's rate (issue #245 slice A).
 *
 * Before #245 the conversion lived here, hand-rolled per stage. That is how a
 * 48 kHz model ended up being fed 16 kHz audio with nobody noticing (#240 B2):
 * an implicit, per-stage, untested assumption. Declaring the rate makes the
 * mismatch structural, and the core does (and tests) the conversion once.
 */

#define NS_SAMPLE_RATE 48000u
#define NS_FRAME 480u /* 10 ms @ 48 kHz — one rnnoise_process_frame call */

typedef struct ns_impl {
  DenoiseState *st;
  /* RNNoise works on float samples in the 16-bit-scaled range; the graph hands
   * us int16, so the conversion needs its own buffers (never reinterpret the
   * int16 buffer as float). */
  float in_buf[NS_FRAME];
  float out_buf[NS_FRAME];
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

/*
 * `frames` holds exactly NS_FRAME samples at 48 kHz (guaranteed by the graph,
 * which converts and buffers). Output is written back to the same buffer.
 */
static int ns_process(void *v, int16_t *frames, size_t n, float *vad_out) {
  ns_impl_t *impl = (ns_impl_t *)v;

  if (impl->denoise_enabled && n == NS_FRAME) {
    for (unsigned i = 0; i < NS_FRAME; ++i) {
      impl->in_buf[i] = (float)frames[i];
    }
    impl->last_vad = rnnoise_process_frame(impl->st, impl->out_buf, impl->in_buf);
    for (unsigned i = 0; i < NS_FRAME; ++i) {
      float v = impl->out_buf[i];
      if (v > 32767.0f) v = 32767.0f;
      if (v < -32768.0f) v = -32768.0f;
      frames[i] = (int16_t)v;
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
  rnnoise_destroy(impl->st);
  impl->st = rnnoise_create(NULL);
}

const wake_afe_stage_ops_t wake_afe_ns_ops = {
    "ns", "RNNoise noise suppression + VAD", ns_create, ns_destroy, ns_process,
    ns_reset, 1 /* provides_vad */, NS_SAMPLE_RATE, NS_FRAME};
