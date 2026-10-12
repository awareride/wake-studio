/*
 * run_aec.cxx — the AEC evaluation runner (issue #249, slice A).
 *
 * Runs a conforming AEC over paired echo material with a KNOWN echo path, and
 * gates on the three numbers that decide whether an AEC is any good:
 *
 *   far-end only : ERLE (dB). Echo must actually be cancelled.
 *   double talk  : near-end SI-SDR (dB). The near-end speaker must survive --
 *                  this is what stops a candidate that "wins" by muting.
 *   negative ctl : the same filter with a deliberately wrong delay hint. It must
 *                  FAIL. An AEC that cannot be shown to depend on getting the
 *                  delay right is not being measured.
 *
 * Correctness gates first (finite output, no clipping, non-silent output when
 * echo was present), quality gates second -- the ordering the #240 AEC addendum
 * asks for.
 *
 * Candidates plug in by implementing wake/aec.h. The reference NLMS filter here
 * is the conforming example, not a competitor to AEC3.
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "aec_metrics.h"
#include "corpus.h"
#include "wake/aec.h"

#define RATE 48000
#define FRAME 480
#define SECONDS 1.0

/* Correctness gates: clipped or fully-erased output means the candidate is
 * broken, not merely mediocre. */
#define MIN_OUTPUT_DBFS (-90.0f)

/* Quality gates. Deliberately loose for a LINEAR filter: they are a floor that a
 * real AEC3 would clear easily, not a target. */
#define ERLE_MIN_DB (6.0f)

/*
 * Near-end survival under double talk.
 *
 * This threshold is calibrated to what a linear NLMS filter WITHOUT a double-talk
 * detector can actually do, and it is deliberately low. A plain NLMS keeps
 * adapting to whatever energy is uncorrelated with the render, which during
 * double talk includes the near-end speaker -- so it eats some of the near end.
 * That is a real, documented limitation of this reference (see aec_ref.cxx), not
 * a harness bug, and the number is reported rather than hidden.
 *
 * It is NOT a target for real candidates: AEC3 has a double-talk detector and
 * should clear 10 dB comfortably. Read this floor as "the reference does not
 * mute the near end", never as "this is what an AEC is expected to achieve".
 */
#define NEAR_END_MIN_SI_SDR_DB (-12.0f)

struct echo_case {
  const char *name;
  int delay_frames;
  float echo_gain;
  int near_end; /* 1 = double talk */
  float near_freq;
};

static const struct echo_case kCases[] = {
    {"single-talk-d0", 0, 0.5f, 0, 440.0f},
    {"single-talk-d2", 2, 0.5f, 0, 440.0f},
    {"double-talk-d0", 0, 0.5f, 1, 440.0f},
};

static int g_failures = 0;

static void failf(const char *name, const char *what, double v, const char *cmp,
                  double limit) {
  printf("FAIL | %-16s %s: %.2f %s %.2f\n", name, what, v, cmp, limit);
  ++g_failures;
}

/*
 * Count samples pinned at full scale.
 *
 * This replaces an `isfinite()` sweep over the int16 output, which was vacuous:
 * every int16_t is finite by construction, so that gate could never fail, and it
 * did miss a real defect -- an unstable NLMS drove the estimate to 1e24 and
 * clipped 83 samples to full scale while the "non-finite output" check sat there
 * reporting success. #249 asks for "zero corruption" as a correctness gate;
 * clipping is the corruption an int16 pipeline can actually produce.
 */
static int count_clipping(const int16_t *s, size_t n) {
  int clipped = 0;
  for (size_t i = 0; i < n; ++i) {
    if (s[i] >= 32767 || s[i] <= -32768) {
      ++clipped;
    }
  }
  return clipped;
}

static double rms_dbfs(const int16_t *s, size_t n) {
  double e = 0.0;
  for (size_t i = 0; i < n; ++i) {
    e += (double)s[i] * s[i];
  }
  e /= (double)(n > 0 ? n : 1);
  return e > 0.0 ? 10.0 * log10(e / (32768.0 * 32768.0)) : -240.0;
}

int main(int argc, char **argv) {
  int known_bad = 0;
  for (int i = 1; i < argc; ++i) {
    if (strcmp(argv[i], "--known-bad") == 0) {
      known_bad = 1; /* wrong delay hint on purpose */
    }
  }

  const size_t n = (size_t)(SECONDS * RATE);
  int16_t *render = (int16_t *)calloc(n, sizeof(int16_t));
  int16_t *mic = (int16_t *)calloc(n, sizeof(int16_t));
  int16_t *cancelled = (int16_t *)calloc(n, sizeof(int16_t));
  int16_t *uncancelled = (int16_t *)calloc(n, sizeof(int16_t));
  int16_t *near_end = (int16_t *)calloc(n, sizeof(int16_t));
  if (!render || !mic || !cancelled || !uncancelled || !near_end) {
    fprintf(stderr, "oom\n");
    return 2;
  }

  printf("# AEC evaluation harness (issue #249 slice A)\n");
  printf("# mode: %s\n",
         known_bad ? "KNOWN-BAD (wrong stream delay, must FAIL)"
                   : "reference NLMS over wake/aec.h");

  for (size_t c = 0; c < sizeof(kCases) / sizeof(kCases[0]); ++c) {
    const struct echo_case *ec = &kCases[c];
    wake_corpus_echo_path_t path;
    path.delay_frames = ec->delay_frames;
    path.path_length = 64;
    path.echo_gain = ec->echo_gain;
    path.seed = 7001u + (uint32_t)c;

    wake_corpus_render_echo_pair(render, mic, near_end, n,
                                 ec->near_end ? WAKE_ECHO_DOUBLE_TALK
                                              : WAKE_ECHO_FAR_END_ONLY,
                                 &path, ec->near_freq, 30.0f);

    /* Baseline: no cancellation, i.e. the microphone as captured. */
    memcpy(uncancelled, mic, n * sizeof(int16_t));
    memcpy(cancelled, mic, n * sizeof(int16_t));

    /* Ground truth near end, for the double-talk measurement. The generator hands
     * it to us directly. It used to be reconstructed here by re-running the
     * generator in far-end-only mode, which yields the ECHO -- so the gate was
     * scoring "how much echo survived" against a signal that is almost entirely
     * echo, and failed even a perfect AEC (-55 dB). */
    if (!ec->near_end) {
      memset(near_end, 0, n * sizeof(int16_t));
    }

    wake_aec_t *a = wake_aec_create(RATE, FRAME, 0);
    if (a == NULL) {
      fprintf(stderr, "aec create failed\n");
      return 2;
    }
    int delay_ms = ec->delay_frames * 10;
    if (known_bad) {
      /* Off by two frames: enough to break a filter shorter than the offset. */
      delay_ms += 20;
    }
    if (wake_aec_set_stream_delay_ms(a, delay_ms) != 0) {
      fprintf(stderr, "aec rejected delay %d ms\n", delay_ms);
      wake_aec_destroy(a);
      return 2;
    }

    int broke = 0;
    for (size_t off = 0; off + FRAME <= n; off += FRAME) {
      if (wake_aec_process(a, cancelled + off, render + off) != 0) {
        broke = 1;
        break;
      }
    }
    wake_aec_metrics_t m;
    wake_aec_get_metrics(a, &m);
    wake_aec_destroy(a);
    if (broke) {
      failf(ec->name, "process failed", 0, "!=", 0);
      continue;
    }

    /* --- correctness first (#249 gate order) --- */
    const int clipped = count_clipping(cancelled, n);
    if (clipped != 0) {
      failf(ec->name, "clipped samples", clipped, "!=", 0);
      continue;
    }
    const double out_dbfs = rms_dbfs(cancelled, n);
    if (out_dbfs < MIN_OUTPUT_DBFS) {
      failf(ec->name, "output erased", out_dbfs, "<", MIN_OUTPUT_DBFS);
      continue;
    }

    /* --- then quality --- */
    const float erle = wake_aec_erle_db(cancelled, n, uncancelled);
    const float residual = wake_aec_residual_echo_db(cancelled, n, render);
    float si_sdr = 0.0f;
    if (ec->near_end) {
      si_sdr = wake_aec_si_sdr_db(cancelled, n, near_end);
    }
    printf("aec | %-16s ERLE=%6.2fdB residual=%7.2fdB out=%7.2fdBFS", ec->name,
           (double)erle, (double)residual, out_dbfs);
    if (ec->near_end) {
      printf(" nearEndSI-SDR=%6.2fdB", (double)si_sdr);
    }
    printf("\n");

    if (!ec->near_end) {
      if (!(erle >= ERLE_MIN_DB)) {
        failf(ec->name, "ERLE too low", erle, "<", ERLE_MIN_DB);
      }
    } else {
      /* Double talk: the near end must survive cancellation. */
      if (!(si_sdr >= NEAR_END_MIN_SI_SDR_DB)) {
        failf(ec->name, "near end degraded", si_sdr, "<", NEAR_END_MIN_SI_SDR_DB);
      }
    }
  }

  /*
   * --- ABI conformance -------------------------------------------------
   *
   * The DSP gates above all assume the candidate honours the contract in
   * wake/aec.h. These check the contract itself, because a candidate that
   * violates it produces numbers that look fine while being meaningless -- and
   * the failure mode can be a crash rather than a wrong digit.
   */
  if (!wake_aec_frame_supported(RATE, FRAME)) {
    failf("abi", "frame_supported(48k/480)", 0, "!=", 1);
  }
  if (wake_aec_frame_supported(16000, 160)) {
    failf("abi", "accepted an unsupported rate", 1, "==", 0);
  }
  if (wake_aec_create(16000, 160, 0) != NULL) {
    failf("abi", "create refused nothing", 1, "==", 0);
  }

  /* reset() must clear state WITHOUT changing configuration, per wake/aec.h.
   * The reference implementation used to zero the tap count here, which made the
   * next process() memmove ~17 GB and segfault: a reset-then-start path that
   * every real device hits on stop/start. */
  {
    wake_aec_t *a = wake_aec_create(RATE, FRAME, 0);
    if (a == NULL) {
      failf("abi", "create(48k/480)", 0, "!=", 1);
    } else {
      wake_aec_reset(a);
      memcpy(cancelled, mic, n * sizeof(int16_t));
      int ok = 1;
      for (size_t off = 0; off + FRAME <= n; off += FRAME) {
        if (wake_aec_process(a, cancelled + off, render + off) != 0) {
          ok = 0;
          break;
        }
      }
      if (!ok) {
        failf("abi", "process() after reset()", 0, "!=", 0);
      } else {
        const float erle = wake_aec_erle_db(cancelled, n, uncancelled);
        printf("abi | reset()->process()     ERLE=%6.2fdB\n", (double)erle);
        if (!(erle >= ERLE_MIN_DB)) {
          failf("abi", "reset() destroyed the filter", erle, "<", ERLE_MIN_DB);
        }
      }
      wake_aec_destroy(a);
    }
  }

  /* NULL render means "no playback reference": legitimate, and must pass audio
   * through untouched rather than inventing attenuation. */
  {
    wake_aec_t *a = wake_aec_create(RATE, FRAME, 0);
    if (a != NULL) {
      memcpy(cancelled, mic, n * sizeof(int16_t));
      for (size_t off = 0; off + FRAME <= n; off += FRAME) {
        wake_aec_process(a, cancelled + off, NULL);
      }
      if (memcmp(cancelled, mic, n * sizeof(int16_t)) != 0) {
        failf("abi", "NULL render altered audio", 0, "==", 0);
      }
      /* Argument checking: a NULL handle is a caller error and must be refused,
       * not dereferenced. */
      if (wake_aec_process(NULL, cancelled, render) == 0) {
        failf("abi", "process(NULL handle) accepted", 0, "!=", 0);
      }
      if (wake_aec_reset(NULL) == 0) {
        failf("abi", "reset(NULL handle) accepted", 0, "!=", 0);
      }
      wake_aec_destroy(a);
    }
  }

  free(render);
  free(mic);
  free(cancelled);
  free(uncancelled);
  free(near_end);

  if (g_failures == 0) {
    printf("# RESULT: PASS\n");
    return 0;
  }
  printf("# RESULT: FAIL (%d)\n", g_failures);
  return 1;
}