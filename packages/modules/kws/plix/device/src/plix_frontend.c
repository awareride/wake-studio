/*
 * plix_frontend.c — C mel frontend for the PLiX device driver (issue #188).
 * See plix_frontend.h for the contract. FFT via kissfft (float).
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "kiss_fft.h"

#include "plix_frontend.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

int plix_frontend_init(plix_frontend_t *fe) {
  size_t i;
  int m, k;

  /* Periodic Hann, 0.5*(1-cos(2*pi*i/400)) — windows.ts hannPeriodic. */
  for (i = 0; i < PLIX_FE_WINDOW_LENGTH; i++) {
    fe->window[i] = 0.5 * (1.0 - cos(2.0 * M_PI * (double)i / PLIX_FE_WINDOW_LENGTH));
  }

  /* HTK filterbank — mel.ts buildMelFilterbank verbatim (double math). */
  {
    const double mel_min = 2595.0 * log10(1.0 + PLIX_FE_MEL_FMIN / 700.0);
    const double mel_max = 2595.0 * log10(1.0 + PLIX_FE_MEL_FMAX / 700.0);
    double hz_points[PLIX_FE_N_MELS + 2];
    for (m = 0; m < PLIX_FE_N_MELS + 2; m++) {
      double mel = mel_min + ((double)m / (PLIX_FE_N_MELS + 1)) * (mel_max - mel_min);
      hz_points[m] = 700.0 * (pow(10.0, mel / 2595.0) - 1.0);
    }
    memset(fe->mel_weights, 0, sizeof(fe->mel_weights));
    for (m = 1; m <= PLIX_FE_N_MELS; m++) {
      double f_left = hz_points[m - 1];
      double f_center = hz_points[m];
      double f_right = hz_points[m + 1];
      int k_left = (int)((f_left / (16000.0 / 2.0)) * (PLIX_FE_NUM_FFT - 1));
      int k_center = (int)((f_center / (16000.0 / 2.0)) * (PLIX_FE_NUM_FFT - 1));
      int k_right = (int)((f_right / (16000.0 / 2.0)) * (PLIX_FE_NUM_FFT - 1));
      /* NOTE: C truncation-toward-zero matches Math.floor here — all
       * operands are non-negative, so (int) cast == floor. */
      for (k = k_left; k < k_center; k++) {
        if (k >= 0 && k < PLIX_FE_NUM_FFT) {
          int denom = k_center - k_left;
          if (denom < 1) denom = 1;
          fe->mel_weights[(m - 1) * PLIX_FE_NUM_FFT + k] =
              (double)(k - k_left) / (double)denom;
        }
      }
      for (k = k_center; k < k_right; k++) {
        if (k >= 0 && k < PLIX_FE_NUM_FFT) {
          int denom = k_right - k_center;
          if (denom < 1) denom = 1;
          fe->mel_weights[(m - 1) * PLIX_FE_NUM_FFT + k] =
              (double)(k_right - k) / (double)denom;
        }
      }
    }
  }

  fe->kiss_cfg = NULL;
  {
    /* TFLM's kissfft.patch neuters KISS_FFT_MALLOC (always NULL), so the
     * plan is placement-supplied: query the size, then install into the
     * inline buffer. */
    size_t needed = 0;
    kiss_fft_alloc(PLIX_FE_N_FFT, 0, NULL, &needed);
    if (needed == 0 || needed > sizeof(fe->kiss_mem)) {
      fprintf(stderr, "[plix-fe] kiss plan needs %zu bytes (have %zu)\n",
              needed, sizeof(fe->kiss_mem));
      return 1;
    }
    fe->kiss_cfg = kiss_fft_alloc(PLIX_FE_N_FFT, 0, fe->kiss_mem, &needed);
    if (fe->kiss_cfg == NULL) {
      return 1;
    }
  }
  fe->history_len = 0;
  fe->ready = 1;
  return 0;
}

void plix_frontend_free(plix_frontend_t *fe) {
  /* No-op: the plan lives in inline state (kiss_fft_free is a neutered
   * stub under TFLM's patch; must NOT free). */
  fe->kiss_cfg = NULL;
  fe->ready = 0;
}

void plix_frontend_reset(plix_frontend_t *fe) {
  fe->history_len = 0;
}

void plix_frontend_frame(plix_frontend_t *fe,
                         const float window_samples[PLIX_FE_WINDOW_LENGTH],
                         float out_mel[PLIX_FE_N_MELS]) {
  int i, m, k;

  /* Window + zero-pad into the complex scratch. */
  for (i = 0; i < PLIX_FE_N_FFT; i++) {
    double v = 0.0;
    if (i < PLIX_FE_WINDOW_LENGTH) {
      v = (double)window_samples[i] * fe->window[i];
    }
    fe->fft_in[2 * i] = (float)v;
    fe->fft_in[2 * i + 1] = 0.0f;
  }
  kiss_fft(fe->kiss_cfg, (const kiss_fft_cpx *)fe->fft_in,
           (kiss_fft_cpx *)fe->fft_out);

  /* Raw |FFT| magnitudes (torchaudio/PLiX convention, no normalization). */
  {
    double mag[PLIX_FE_NUM_FFT];
    for (k = 0; k < PLIX_FE_NUM_FFT; k++) {
      double re = (double)fe->fft_out[2 * k];
      double im = (double)fe->fft_out[2 * k + 1];
      mag[k] = sqrt(re * re + im * im);
    }
    for (m = 0; m < PLIX_FE_N_MELS; m++) {
      double sum = 0.0;
      const double *w = fe->mel_weights + (size_t)m * PLIX_FE_NUM_FFT;
      for (k = 0; k < PLIX_FE_NUM_FFT; k++) {
        sum += w[k] * mag[k];
      }
      out_mel[m] = (float)sum;
    }
  }
}

int plix_frontend_push(plix_frontend_t *fe, const int16_t *samples, size_t n,
                       float out_mel[PLIX_FE_N_MELS]) {
  size_t i;

  if (!fe->ready || samples == NULL) {
    return 0;
  }
  /* Slide the history; keep the last WINDOW_LENGTH samples. */
  if (n >= PLIX_FE_WINDOW_LENGTH) {
    for (i = 0; i < PLIX_FE_WINDOW_LENGTH; i++) {
      fe->history[i] = (float)samples[n - PLIX_FE_WINDOW_LENGTH + i];
    }
    fe->history_len = PLIX_FE_WINDOW_LENGTH;
  } else {
    size_t keep = 0;
    if (fe->history_len + n > PLIX_FE_WINDOW_LENGTH) {
      keep = PLIX_FE_WINDOW_LENGTH - n;
      memmove(fe->history, fe->history + (fe->history_len - keep),
              keep * sizeof(float));
    } else {
      keep = fe->history_len;
      if (keep > 0) {
        memmove(fe->history, fe->history + (fe->history_len - keep),
                keep * sizeof(float));
      }
    }
    for (i = 0; i < n; i++) {
      fe->history[keep + i] = (float)samples[i];
    }
    fe->history_len = keep + n;
  }

  if (fe->history_len < PLIX_FE_WINDOW_LENGTH) {
    return 0; /* warmup */
  }
  /* Caller feeds HOP_LENGTH per call: the history IS the current window.
   * Larger chunks emit the newest frame (documented contract). */
  plix_frontend_frame(fe, fe->history, out_mel);
  return 1;
}
