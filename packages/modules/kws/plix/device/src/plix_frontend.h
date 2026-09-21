/*
 * plix_frontend.h — C mel frontend for the PLiX device driver (issue #188).
 *
 * Ports packages/dsp/src/{mel,stft,windows}.ts (themselves ported verbatim
 * from plixkws/backbone.py) to C99 with no heap after init:
 *   16 kHz audio -> 64-bin RAW-magnitude mel, win 400 / hop 160 / n_fft 1024,
 *   60-7800 Hz HTK filterbank. The exported ONNX graph applies log(mel+1e-6)
 *   internally, so output stays raw magnitude (feeding logged values would
 *   double-log -> NaN; see encoders/plix-frontend.ts).
 *
 * Conventions (must match the TS exactly):
 *   - periodic Hann window, 0.5*(1-cos(2*pi*i/400));
 *   - frames [start,start+400), zero-padded to 1024, unnormalized |FFT|
 *     (torchaudio/PLiX convention — no 1/winSum scaling);
 *   - HTK mel (2595*log10(1+f/700)), triangular filters with floor bin
 *     mapping, no area normalization;
 *   - layout [melBin] per emitted frame (caller stacks frames).
 * Math runs in double (filterbank + accumulation); FFT via kissfft float;
 * storage is float. Parity is locked by L1 fixtures generated from the dsp
 * package itself (see ../tests + the generator note in plix.test.cxx).
 */
#ifndef WAKE_PLIX_FRONTEND_H
#define WAKE_PLIX_FRONTEND_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define PLIX_FE_SAMPLE_RATE 16000
#define PLIX_FE_WINDOW_LENGTH 400
#define PLIX_FE_HOP_LENGTH 160
#define PLIX_FE_N_FFT 1024
#define PLIX_FE_N_MELS 64
#define PLIX_FE_MEL_FMIN 60.0
#define PLIX_FE_MEL_FMAX 7800.0
#define PLIX_FE_NUM_FFT (PLIX_FE_N_FFT / 2 + 1) /* 513 */

/* Streaming frontend state. All buffers are caller-visible statics (no
 * malloc): window table + filterbank weights are derived constants. */
typedef struct plix_frontend {
  double window[PLIX_FE_WINDOW_LENGTH];
  double mel_weights[PLIX_FE_N_MELS * PLIX_FE_NUM_FFT];
  /* KissFFT config lives in this inline buffer (TFLM's kissfft.patch
   * neuters KISS_FFT_MALLOC, so the config is placement-supplied, never
   * malloc'd — same pattern as TFLM's own microfrontend use). Sized for a
   * 1024-pt plan with headroom; init fails loudly if insufficient. */
  uint8_t kiss_mem[9216];
  void *kiss_cfg;
  float fft_in[PLIX_FE_N_FFT * 2];   /* interleaved complex scratch */
  float fft_out[PLIX_FE_N_FFT * 2];  /* interleaved complex scratch */
  /* Sliding input history: the last WINDOW_LENGTH samples. */
  float history[PLIX_FE_WINDOW_LENGTH];
  size_t history_len; /* valid samples in history (< WINDOW until primed) */
  int ready;
} plix_frontend_t;

/* Derive window + filterbank tables and allocate the FFT plan. Returns 0 on
 * success. Must be called once before push; free with plix_frontend_free. */
int plix_frontend_init(plix_frontend_t *fe);

/* Release the FFT plan (tables are inline state, nothing to free). */
void plix_frontend_free(plix_frontend_t *fe);

/* Reset the sliding history (keeps the derived tables + FFT plan). */
void plix_frontend_reset(plix_frontend_t *fe);

/*
 * Push int16 samples; when a full window is available past the hop step,
 * emit one 64-bin raw-magnitude mel frame into out_mel and return 1.
 * Otherwise return 0 (warmup: the first WINDOW_LENGTH samples accumulate).
 * Feeding exactly HOP_LENGTH samples per call yields one frame per call
 * after priming — the driver's 10 ms cadence.
 */
int plix_frontend_push(plix_frontend_t *fe, const int16_t *samples, size_t n,
                       float out_mel[PLIX_FE_N_MELS]);

/*
 * One-shot mel frame over an explicit 400-sample window (no streaming
 * state). Used by the L1 parity fixtures.
 */
void plix_frontend_frame(plix_frontend_t *fe, const float window_samples[PLIX_FE_WINDOW_LENGTH],
                         float out_mel[PLIX_FE_N_MELS]);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_PLIX_FRONTEND_H */
