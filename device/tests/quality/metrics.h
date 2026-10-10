/*
 * metrics.h — objective metrics for the AFE quality harness (#247).
 *
 * Scope and honesty, from the #240 VAD/BSS addenda:
 *  - For **NS** the ground truth is exact: render noise-only, run the stage, and
 *    what survives IS the residual noise. So residual-to-input energy ratio is a
 *    real measurement, not a proxy.
 *  - Segmental SNR is the primary NS gate, measured against the noise-only
 *    reference on the same seed. PESQ/STOI/DNSMOS are diagnostics only and are
 *    deliberately absent: they need reference implementations that would drag a
 *    Python dependency into a device test.
 *  - AEC/BSS/VAD metrics need paired reference material and are later slices.
 */
#ifndef WAKE_QUALITY_METRICS_H
#define WAKE_QUALITY_METRICS_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct wake_quality_clip_metrics {
  /* Residual-to-input energy ratio, dB. Negative means noise was removed. */
  float residual_db;
  /* Frame-mean SNR against the noise-only reference, dB. */
  float seg_snr_db;
  /* Worst (lowest) frame SNR: catches musical noise that averages out. */
  float worst_seg_snr_db;
  /* Fraction of frames that carry no output at all (over-suppression). */
  float silent_frame_ratio;
} wake_quality_clip_metrics_t;

/** Root-mean-square of an int16 buffer. */
float wake_quality_rms_dbfs(const int16_t *samples, size_t n);

/**
 * Residual: energy of `processed` relative to the noise-only `reference`
 * rendered from the same seed. < 0 dB means the stage removed energy.
 */
float wake_quality_residual_db(const int16_t *processed, size_t n,
                               const int16_t *reference);

/**
 * Segmental SNR in dB over `frame` samples, computed against `reference`.
 * Frames whose reference energy is below `floor_dbfs` are skipped (nothing to
 * improve there), which is the standard convention.
 */
float wake_quality_seg_snr_db(const int16_t *processed, size_t n,
                              const int16_t *reference, size_t frame,
                              float floor_dbfs);

/** Lowest frame SNR across the clip (musical-noise / over-suppression guard). */
float wake_quality_worst_seg_snr_db(const int16_t *processed, size_t n,
                                    const int16_t *reference, size_t frame,
                                    float floor_dbfs);

/** Fraction of frames whose processed RMS is at or below the noise floor. */
float wake_quality_silent_frame_ratio(const int16_t *processed, size_t n,
                                      size_t frame, float floor_dbfs);

/** Fill a metrics struct for one clip. */
void wake_quality_measure(const int16_t *processed, size_t n,
                          const int16_t *reference, size_t frame,
                          float floor_dbfs,
                          wake_quality_clip_metrics_t *out);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_QUALITY_METRICS_H */