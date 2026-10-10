/*
 * known_bad_stage.cxx — the negative control for the quality harness (#247).
 *
 * This is the pre-#244 device NS stage, preserved deliberately: it declares
 * 48000/480 so the graph hands it a frame unchanged, then buffers three frames
 * and pushes 480 samples of whatever it received straight into the 48 kHz RNNoise
 * model -- the bug that made digital silence cross the trigger threshold
 * (#240 B2).
 *
 * Its only job is to be WRONG in exactly that way, so CI can assert that the
 * harness FAILS on it. A quality gate that cannot fail on a known-bad build is
 * decoration; this file is what makes the gate honest.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "rnnoise.h"
#include "wake/afe_graph.h"

#define NS_FRAME 480

typedef struct known_bad_impl {
  DenoiseState *st;
  int16_t buf[NS_FRAME];
  float in_f[NS_FRAME];
  float out_f[NS_FRAME];
  unsigned fill;
  int pending;
  unsigned out_at;
  float last_vad;
} known_bad_impl_t;

static void *kb_create(void) {
  known_bad_impl_t *impl = (known_bad_impl_t *)calloc(1, sizeof(known_bad_impl_t));
  if (impl == NULL) {
    return NULL;
  }
  impl->st = rnnoise_create(NULL);
  if (impl->st == NULL) {
    free(impl);
    return NULL;
  }
  return impl;
}

static void kb_destroy(void *v) {
  known_bad_impl_t *impl = (known_bad_impl_t *)v;
  if (impl == NULL) {
    return;
  }
  if (impl->st != NULL) {
    rnnoise_destroy(impl->st);
  }
  free(impl);
}

static int kb_process(void *v, const wake_afe_frame_t *in,
                      wake_afe_frame_t *out, float *vad_out) {
  known_bad_impl_t *impl = (known_bad_impl_t *)v;
  int16_t *frames = in->channels[0];
  const size_t n = in->frame_samples;
  size_t i;

  for (i = 0; i < n && impl->fill < NS_FRAME; ++i) {
    impl->buf[impl->fill++] = frames[i];
  }
  /* Drain whatever the previous model call produced. */
  if (impl->pending) {
    unsigned m = (unsigned)n;
    if (m > NS_FRAME - impl->out_at) {
      m = NS_FRAME - impl->out_at;
    }
    for (i = 0; i < m; ++i) {
      frames[i] = (int16_t)impl->out_f[impl->out_at + i];
    }
    impl->out_at += m;
    if (impl->out_at >= NS_FRAME) {
      impl->pending = 0;
      impl->out_at = 0;
    }
  }
  if (impl->fill == NS_FRAME) {
    /* The bug: these 480 samples are whatever rate the caller used, pushed
     * into a model that requires 48 kHz. */
    for (i = 0; i < NS_FRAME; ++i) {
      impl->in_f[i] = (float)impl->buf[i];
    }
    impl->last_vad = rnnoise_process_frame(impl->st, impl->out_f, impl->in_f);
    impl->pending = 1;
    impl->out_at = 0;
    impl->fill = 0;
  }
  if (vad_out != NULL) {
    *vad_out = impl->last_vad;
  }
  (void)out;
  return 0;
}

static void kb_reset(void *v) {
  known_bad_impl_t *impl = (known_bad_impl_t *)v;
  impl->fill = 0;
  impl->pending = 0;
  impl->out_at = 0;
  impl->last_vad = 0.0f;
}

extern "C" const wake_afe_stage_ops_t wake_quality_known_bad_ops = {
    "ns", "NS (KNOWN-BAD: 48 kHz model fed unrated audio, #240 B2)", kb_create,
    kb_destroy, kb_process, kb_reset, 1 /* provides_vad */,
    48000u, NS_FRAME, 1, 1, 0};