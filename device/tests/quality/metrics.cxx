/*
 * metrics.cxx — objective metrics (wake_quality_metrics.h). See metrics.h for
 * why these are the measurements that can be trusted without a reference
 * implementation.
 */
#include "metrics.h"

#include <math.h>

static double frame_energy(const int16_t *s, size_t n) {
  double e = 0.0;
  for (size_t i = 0; i < n; ++i) {
    const double v = (double)s[i];
    e += v * v;
  }
  return e / (double)(n > 0 ? n : 1);
}

float wake_quality_rms_dbfs(const int16_t *samples, size_t n) {
  const double e = frame_energy(samples, n);
  if (e <= 0.0) {
    return -240.0f; /* effectively digital silence */
  }
  return (float)(10.0 * log10(e / (32768.0 * 32768.0)));
}

float wake_quality_residual_db(const int16_t *processed, size_t n,
                               const int16_t *reference) {
  const double ep = frame_energy(processed, n);
  const double er = frame_energy(reference, n);
  if (er <= 0.0) {
    return 0.0f;
  }
  if (ep <= 0.0) {
    return -240.0f;
  }
  return (float)(10.0 * log10(ep / er));
}

/* Shared frame walk: computes mean and worst frame SNR plus silence ratio. */
static void seg_walk(const int16_t *processed, size_t n,
                     const int16_t *reference, size_t frame, float floor_dbfs,
                     float *mean_db, float *worst_db, float *silent_ratio) {
  if (frame == 0 || n < frame) {
    if (mean_db) *mean_db = 0.0f;
    if (worst_db) *worst_db = 0.0f;
    if (silent_ratio) *silent_ratio = 0.0f;
    return;
  }
  const double floor_lin = pow(10.0, (double)floor_dbfs / 10.0);
  double sum = 0.0;
  int counted = 0;
  float worst = 1e30f;
  size_t silent = 0;
  size_t total = 0;

  for (size_t off = 0; off + frame <= n; off += frame) {
    const double er = frame_energy(reference + off, frame);
    const double ep = frame_energy(processed + off, frame);
    ++total;
    if (ep <= floor_lin * 32768.0 * 32768.0) {
      ++silent;
    }
    /* Skip frames with no reference energy: there is nothing to improve. */
    if (er <= floor_lin * 32768.0 * 32768.0) {
      continue;
    }
    const double snr = 10.0 * log10(er / (ep > 1e-30 ? ep : 1e-30));
    sum += snr;
    ++counted;
    if ((float)snr < worst) {
      worst = (float)snr;
    }
  }
  if (mean_db) {
    *mean_db = counted > 0 ? (float)(sum / (double)counted) : 0.0f;
  }
  if (worst_db) {
    *worst_db = counted > 0 ? worst : 0.0f;
  }
  if (silent_ratio) {
    *silent_ratio = total > 0 ? (float)((double)silent / (double)total) : 0.0f;
  }
}

float wake_quality_seg_snr_db(const int16_t *processed, size_t n,
                              const int16_t *reference, size_t frame,
                              float floor_dbfs) {
  float mean = 0.0f, worst = 0.0f, silent = 0.0f;
  seg_walk(processed, n, reference, frame, floor_dbfs, &mean, &worst, &silent);
  return mean;
}

float wake_quality_worst_seg_snr_db(const int16_t *processed, size_t n,
                                    const int16_t *reference, size_t frame,
                                    float floor_dbfs) {
  float mean = 0.0f, worst = 0.0f, silent = 0.0f;
  seg_walk(processed, n, reference, frame, floor_dbfs, &mean, &worst, &silent);
  return worst;
}

float wake_quality_silent_frame_ratio(const int16_t *processed, size_t n,
                                      size_t frame, float floor_dbfs) {
  if (frame == 0 || n < frame) {
    return 0.0f;
  }
  /* Over-suppression guard: how often the stage emits nothing at all. Needs no
   * reference -- silence in the OUTPUT is the fact being measured. */
  const double floor_lin = pow(10.0, (double)floor_dbfs / 10.0);
  size_t silent = 0;
  size_t total = 0;
  for (size_t off = 0; off + frame <= n; off += frame) {
    const double ep = frame_energy(processed + off, frame);
    ++total;
    if (ep <= floor_lin * 32768.0 * 32768.0) {
      ++silent;
    }
  }
  return total > 0 ? (float)((double)silent / (double)total) : 0.0f;
}

void wake_quality_measure(const int16_t *processed, size_t n,
                          const int16_t *reference, size_t frame,
                          float floor_dbfs,
                          wake_quality_clip_metrics_t *out) {
  if (out == NULL) {
    return;
  }
  out->residual_db = wake_quality_residual_db(processed, n, reference);
  seg_walk(processed, n, reference, frame, floor_dbfs, &out->seg_snr_db,
           &out->worst_seg_snr_db, &out->silent_frame_ratio);
}