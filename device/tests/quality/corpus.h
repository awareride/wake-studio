/*
 * corpus.h — deterministic synthetic corpus for the AFE quality harness (#247).
 *
 * Why synthetic and in-repo:
 *  - the corpus must be **bit-reproducible** from a seed, on every machine, with
 *    no download and no dependency to install. A quality number that cannot be
 *    regenerated is not evidence;
 *  - bulk audio must not be committed (ADR-027 spirit), so the *generator* is the
 *    artifact and the audio is derived on demand;
 *  - pyroomacoustics / ssspy are test-only oracles (ADR-048 §13): they may
 *    generate richer material offline, but the committed suite must not depend on
 *    them being installed.
 *
 * Everything here is integer/LCG-driven, so two runs on two machines produce
 * identical samples -- which is what lets the harness gate on thresholds.
 */
#ifndef WAKE_QUALITY_CORPUS_H
#define WAKE_QUALITY_CORPUS_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Deterministic 32-bit LCG (Numerical Recipes constants). Same sequence
 * everywhere; no libc rand(), whose sequence is implementation-defined. */
typedef struct wake_corpus_rng {
  uint32_t state;
} wake_corpus_rng_t;

void wake_corpus_rng_seed(wake_corpus_rng_t *rng, uint32_t seed);

/** Uniform in [-1, 1). */
float wake_corpus_noise(wake_corpus_rng_t *rng);

/* Echo clip kinds (#249): paired far-end / near-end material with a KNOWN echo
 * path, so residual echo and ERLE are measured against ground truth. */
typedef enum wake_corpus_echo_kind {
  WAKE_ECHO_FAR_END_ONLY = 0, /* playback only: pure echo, no near-end */
  WAKE_ECHO_DOUBLE_TALK = 1   /* playback + near-end speech-like signal */
} wake_corpus_echo_kind_t;

/** Parameters of the synthetic echo path. All times in samples at 48 kHz. */
typedef struct wake_corpus_echo_path {
  int delay_frames;  /* bulk delay before the echo path starts */
  int path_length;   /* RIR length in samples */
  float echo_gain;   /* attenuation of the reflected path */
  uint32_t seed;     /* seeds the RIR realisation AND the far-end source */
} wake_corpus_echo_path_t;

/**
 * Render a paired echo clip.
 *
 * `render` receives the far-end playback signal (broadband, seeded: a tone stack
 * would be periodic, and ERLE against a periodic signal cannot distinguish a
 * correct AEC from a misaligned one). `capture` receives the microphone signal =
 * delayed echo + near end + self noise.
 *
 * `near_end_out` (may be NULL) receives the CLEAN near-end component on its own.
 * It is the ground truth for near-end survival (SI-SDR), and the generator hands
 * it over rather than making the caller reconstruct it: re-deriving it from a
 * different generator mode yields the ECHO, which scores the wrong quantity and
 * fails even a perfect AEC.
 *
 * The render/capture relationship is exact and reproducible, which is what makes
 * ERLE and residual echo measurements rather than opinions.
 */
void wake_corpus_render_echo_pair(int16_t *render, int16_t *capture,
                                  int16_t *near_end_out, size_t n,
                                  wake_corpus_echo_kind_t kind,
                                  const wake_corpus_echo_path_t *path,
                                  float near_end_freq_hz, float noise_snr_db);

/* Clip kinds the committed corpus can produce. */
typedef enum wake_corpus_kind {
  WAKE_CORPUS_TONE = 0,      /* pure tone: pure signal, no noise */
  WAKE_CORPUS_TONE_NOISE = 1, /* tone + white/pink noise at a given SNR */
  WAKE_CORPUS_NOISE = 2,      /* noise only */
  WAKE_CORPUS_REVERB_TONE = 3 /* tone convolved with a synthetic RIR */
} wake_corpus_kind_t;

/**
 * Render one clip in place.
 *
 * `out` receives `n` samples at 48 kHz (the AFE-internal rate, #245). The
 * parameters fully determine the samples: same (kind, seed, snr_db, freq_hz,
 * rt60, n) always yields the same clip, byte for byte.
 */
void wake_corpus_render(int16_t *out, size_t n, wake_corpus_kind_t kind,
                        uint32_t seed, float snr_db, float freq_hz,
                        float rt60_s);

/**
 * The CLEAN component of a clip: the tone, or the tone convolved with the RIR,
 * with no noise added.
 *
 * Together with wake_corpus_render_noise() this gives the harness proper ground
 * truth: "what should be there" and "what was added", as two separately scaled
 * renderings of the SAME noise realisation. Comparing a noisy clip against a
 * differently scaled noise rendering is not a measurement.
 */
void wake_corpus_render_clean(int16_t *out, size_t n, wake_corpus_kind_t kind,
                              uint32_t seed, float snr_db, float freq_hz,
                              float rt60_s);

/**
 * The noise realisation alone, for the same (kind, seed) that
 * wake_corpus_render() adds to the clean signal. Identical samples, separately
 * scaled, so the two can be combined or measured against each other.
 */
void wake_corpus_render_noise(int16_t *out, size_t n, wake_corpus_kind_t kind,
                              uint32_t seed, float snr_db, float freq_hz,
                              float rt60_s);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_QUALITY_CORPUS_H */