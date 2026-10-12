/*
 * aec_metrics.h — AEC metrics for the quality harness (#249).
 *
 * Definitions, stated because AEC numbers are easy to quote and hard to mean:
 *
 *  - **ERLE** (echo return loss enhancement), dB: far-end only, no near-end.
 *    Computed as 10*log10(E[uncancelled]/E[cancelled]) -- i.e. the improvement
 *    this AEC achieved over doing nothing, not an absolute level. Reporting the
 *    absolute residual alone would let a clip with no echo at all look like an
 *    infinite win. NOTE: this is only meaningful if the far end is broadband; on
 *    a periodic far end the number measures the test tone's period, not the AEC.
 *  - **Residual echo level**, dB relative to the render signal.
 *  - **Near-end SI-SDR**, dB, under double talk: how much of the near-end
 *    speaker survives. This is the metric that stops a "great" AEC that just
 *    mutes the near end, and it is why it is gated rather than reported.
 *
 * All of these assume the ground-truth echo path known to the corpus generator,
 * which is what makes them measurements rather than opinions.
 */
#ifndef WAKE_AEC_METRICS_H
#define WAKE_AEC_METRICS_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Residual echo level after cancellation, dB relative to the render energy. */
float wake_aec_residual_echo_db(const int16_t *out, size_t n,
                                const int16_t *render);

/** ERLE of a cancelled capture, dB (higher is better). */
float wake_aec_erle_db(const int16_t *cancelled, size_t n,
                       const int16_t *uncancelled);

/**
 * Scale-invariant SDR of `out` against `reference`, dB. Scale-invariant so a
 * candidate that applies gain is not penalised for it.
 */
float wake_aec_si_sdr_db(const int16_t *out, size_t n,
                         const int16_t *reference);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_AEC_METRICS_H */