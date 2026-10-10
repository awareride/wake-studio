/*
 * wake/resample.h — core-owned integer-ratio sample-rate conversion.
 *
 * Why this exists (#245): the AFE graph and the AFE stages do not, and did not,
 * share a sample rate. The browser runs its chain at 48 kHz and downsamples
 * before the KWS; the device graph runs at 16 kHz. A stage that needs 48 kHz
 * (RNNoise is 48 kHz-only) therefore has to convert by itself, which is how a
 * 48 kHz model ended up being fed 16 kHz audio with nobody noticing
 * (issue #240 B2).
 *
 * The fix in two steps: stages now *declare* their rate (issue #245 slice A), and
 * the graph owns the conversion instead of each stage hand-rolling it. This
 * header is the single implementation both use.
 *
 * Scope and limits, deliberately explicit:
 * - **Integer ratios only.** Rates that are not integer multiples (e.g. 44.1 kHz,
 *   22.05 kHz) are rejected at creation rather than silently approximated. All
 *   rates WakeStudio uses (16 kHz, 48 kHz) are integers.
 * - Streaming, with filter history carried across calls, so no block-boundary
 *   transient and no sample loss or duplication.
 * - Fixed cost per stage: the filter state is a few hundred bytes, sized from
 *   the ratio at creation.
 */
#ifndef WAKE_RESAMPLE_H
#define WAKE_RESAMPLE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct wake_resampler wake_resampler_t;

/**
 * Create a converter from `in_rate_hz` to `out_rate_hz`.
 * Both must be non-zero and their ratio must be an integer. Returns NULL on an
 * unsupported (non-integer) ratio or allocation failure.
 */
wake_resampler_t *wake_resampler_create(uint32_t in_rate_hz,
                                        uint32_t out_rate_hz);

void wake_resampler_destroy(wake_resampler_t *r);

/** out_rate / in_rate as an integer (>= 1). 1 means no conversion is needed. */
unsigned wake_resampler_ratio(const wake_resampler_t *r);

/**
 * Convert one block.
 *
 * `in` holds `n_in` samples at the input rate; `out` must have room for
 * `wake_resampler_capacity(r, n_in)` samples. Writes the number produced to
 * `*n_out`. A streaming converter may hold back a partial output block (when
 * downsampling), so `*n_out` can legitimately be 0 for small inputs.
 *
 * Returns 0 on success.
 */
int wake_resampler_process(wake_resampler_t *r, const int16_t *in, size_t n_in,
                           int16_t *out, size_t *n_out);

/** Worst-case output samples for an input of `n_in`. */
size_t wake_resampler_capacity(const wake_resampler_t *r, size_t n_in);

/** Clear filter history (e.g. on start/stop). */
void wake_resampler_reset(wake_resampler_t *r);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_RESAMPLE_H */