/*
 * rms_backend.c — host reference KWS backend (demo/harness only).
 *
 * Scores a frame by its RMS: loud frames score high, silence scores ~0.
 * Exercises the full loop (AFE → backend → smoother → trigger) on the host
 * with no model files — the device drivers (#185/#188) replace this for real
 * wake-word detection.
 */
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#include "wake/kws_backend.h"

/* RMS (int16 scale) above which the score saturates at 1.0. */
#define RMS_FULL_SCALE 8000.0f

typedef struct rms_impl {
  int loaded;
} rms_impl_t;

static void *rms_create(const wake_kws_config_t *cfg) {
  (void)cfg;
  return calloc(1, sizeof(rms_impl_t));
}
static void rms_destroy(void *v) { free(v); }
static int rms_load(void *v, const wake_model_bundle_t *models,
                    const wake_kws_config_t *cfg) {
  (void)cfg;
  rms_impl_t *impl = (rms_impl_t *)v;
  (void)models; /* no model files needed */
  impl->loaded = 1;
  return 0;
}
static float rms_process(void *v, const int16_t *samples, size_t n) {
  (void)v;
  double sum = 0.0;
  for (size_t i = 0; i < n; ++i) {
    double s = (double)samples[i];
    sum += s * s;
  }
  double rms = n > 0 ? sqrt(sum / (double)n) : 0.0;
  float score = (float)(rms / RMS_FULL_SCALE);
  if (score > 1.0f) score = 1.0f;
  if (score < 0.0f) score = 0.0f;
  return score;
}
static void rms_reset(void *v) {
  rms_impl_t *impl = (rms_impl_t *)v;
  impl->loaded = 0;
}

const wake_kws_backend_ops_t wake_kws_rms_ops = {
    "rms", "RMS reference (host demo)", rms_create, rms_destroy, rms_load,
    rms_process, rms_reset};
