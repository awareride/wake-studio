/*
 * microwakeword_driver.c — micro-wake-word device driver (issue #185).
 *
 * C KWSBackend adapter for the MCU-tier backend (ADR-020/019): TFLite-Micro
 * streaming int8 model. This module defines the full driver shape; the
 * TFLite-Micro runtime integration is a pinned third-party dependency with
 * its own build flags, tracked as the next step (see README).
 *
 * Runtime gating: WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME (CMake option, default
 * OFF). Without the runtime, load() reports a clear "runtime not linked"
 * error and process_frame() stays in warmup (-1) — the module still compiles
 * and registers, so the composition root and capabilities work end-to-end.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "wake/kws_backend.h"

typedef struct microwakeword_impl {
  char model_path[512];
  int loaded;
  int has_runtime; /* 0 without WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME */
} microwakeword_impl_t;

static void *microwakeword_create(const wake_kws_config_t *cfg) {
  (void)cfg;
  return calloc(1, sizeof(microwakeword_impl_t));
}

static void microwakeword_destroy(void *v) { free(v); }

static int microwakeword_load(void *v, const wake_model_bundle_t *models,
                              const wake_kws_config_t *cfg) {
  (void)cfg;
  microwakeword_impl_t *impl = (microwakeword_impl_t *)v;
#if defined(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)
  impl->has_runtime = 1;
  if (models == NULL || models->model_dir == NULL) {
    return 1;
  }
  snprintf(impl->model_path, sizeof(impl->model_path), "%s/microwakeword.tflite",
           models->model_dir);
  FILE *f = fopen(impl->model_path, "rb");
  if (f == NULL) {
    return 1; /* model file missing */
  }
  fclose(f);
  impl->loaded = 1;
  return 0;
#else
  (void)impl;
  return 1; /* TFLite-Micro runtime not linked in this build */
#endif
}

static float microwakeword_process_frame(void *v, const int16_t *samples,
                                        size_t n) {
  microwakeword_impl_t *impl = (microwakeword_impl_t *)v;
  (void)samples;
  (void)n;
#if defined(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)
  if (!impl->loaded) {
    return -1.0f; /* warmup */
  }
  /* TFLite-Micro inference over the streaming int8 model lands with the
   * runtime integration (see README). */
  return -1.0f;
#else
  (void)impl;
  return -1.0f; /* warmup — runtime not linked */
#endif
}

static void microwakeword_reset(void *v) {
  microwakeword_impl_t *impl = (microwakeword_impl_t *)v;
  impl->loaded = 0;
}

const wake_kws_backend_ops_t wake_kws_microwakeword_ops = {
    "microwakeword", "micro-wake-word (MCU, TFLite-Micro)",
    microwakeword_create, microwakeword_destroy, microwakeword_load,
    microwakeword_process_frame, microwakeword_reset};
