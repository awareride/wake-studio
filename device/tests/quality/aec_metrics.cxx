/*
 * aec_metrics.cxx — AEC metrics (see aec_metrics.h for the definitions and why
 * each one is phrased the way it is).
 */
#include "aec_metrics.h"

#include <math.h>

static double energy(const int16_t *s, size_t n) {
  double e = 0.0;
  for (size_t i = 0; i < n; ++i) {
    const double v = (double)s[i];
    e += v * v;
  }
  return e / (double)(n > 0 ? n : 1);
}

static double safe_db(double num, double den) {
  if (den <= 0.0) {
    return 240.0; /* nothing left to improve: report the floor, not infinity */
  }
  if (num <= 0.0) {
    return -240.0;
  }
  return 10.0 * log10(num / den);
}

float wake_aec_residual_echo_db(const int16_t *out, size_t n,
                                const int16_t *render) {
  return (float)safe_db(energy(out, n), energy(render, n));
}

float wake_aec_erle_db(const int16_t *cancelled, size_t n,
                       const int16_t *uncancelled) {
  return (float)safe_db(energy(uncancelled, n), energy(cancelled, n));
}

float wake_aec_si_sdr_db(const int16_t *out, size_t n,
                         const int16_t *reference) {
  if (out == NULL || reference == NULL || n == 0) {
    /* Guard before the loop, not after: a NULL reference dereferenced to zero
     * entries first and segfaulted on the caller's data, which is a very
     * expensive way to learn that a metric was handed nothing. */
    return 0.0f;
  }
  /* SI-SDR: project out the optimal scale, then measure what is left as error. */
  double dot = 0.0, ref_e = 0.0, out_e = 0.0;
  for (size_t i = 0; i < n; ++i) {
    dot += (double)out[i] * reference[i];
    ref_e += (double)reference[i] * reference[i];
    out_e += (double)out[i] * out[i];
  }
  if (ref_e <= 0.0) {
    return 0.0f;
  }
  const double alpha = dot / ref_e; /* optimal scaling of the projection */
  double sig = 0.0, noise = 0.0;
  for (size_t i = 0; i < n; ++i) {
    const double proj = alpha * reference[i];
    sig += proj * proj;
    const double err = (double)out[i] - proj;
    noise += err * err;
  }
  if (noise <= 0.0) {
    return 240.0f;
  }
  return (float)(10.0 * log10(sig / noise));
}
