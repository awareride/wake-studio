/*
 * run_ns.cxx — the AFE quality harness (issue #247, slice A).
 *
 * Runs the NS stage over the deterministic corpus and reports objective metrics
 * against explicit thresholds. Exit code 0 = pass, 1 = fail, so a regression is a
 * red build rather than a number somebody has to notice.
 *
 * Two gated metrics, both with unambiguous physics:
 *
 *  1. **Residual on noise-only ground truth** (dB, relative to input energy).
 *     For a noise-only input there is no signal to protect, so whatever survives
 *     IS the residual noise. A working denoiser must remove most of it; a stage
 *     that is broken, mis-rated or bypassed does not. This is a measurement, not
 *     a proxy.
 *
 *  2. **Clean-signal preservation** (dB of energy change). The same stage run on
 *     a clean tone / reverberant tone. A denoiser that improves SNR by erasing
 *     the signal fails here. This is the over-suppression guard, and it is the
 *     metric that would have caught the pre-#244 build on its own.
 *
 * Segmental SNR against a noisy reference is reported as a diagnostic only. It
 * needs time alignment across the stage's latency, and an unaligned SNR number
 * that looks authoritative is worse than none -- PESQ/STOI/DNSMOS are likewise
 * absent by policy (ADR-048 §9: diagnostics, never the gate).
 *
 * Known-bad mode (--known-bad) runs the pre-#244 stage, which pushed 48 kHz
 * audio into a 48 kHz model at the wrong rate. CI asserts it FAILS: a quality gate
 * that cannot fail on a known-bad build is decoration.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "corpus.h"
#include "metrics.h"
#include "wake/afe_graph.h"

extern "C" const wake_afe_stage_ops_t wake_afe_ns_ops;
/* The pre-#244 stage, preserved as a negative control (known_bad_stage.cxx). */
extern "C" const wake_afe_stage_ops_t wake_quality_known_bad_ops;

#define CLIP_SECONDS 1.0
#define SAMPLE_RATE 48000
#define FRAME 480

/* Thresholds: loose enough to survive int16 rounding and platform drift, tight
 * enough that a stage which is not working at all cannot pass. */
#define RESIDUAL_MAX_DB (-6.0f)  /* noise-only: must remove most of it */
#define CLEAN_PRESERVE_MIN_DB (-4.0f) /* clean tone must not lose > 4 dB */
#define CLEAN_PRESERVE_MAX_DB (4.0f)  /* nor gain > 4 dB (no pumping) */
#define CLEAN_SILENT_MAX (0.20f)   /* nor be erased entirely */

struct clip_plan {
  const char *name;
  wake_corpus_kind_t kind;
  uint32_t seed;
  float snr_db;
  float freq_hz;
};

static const struct clip_plan kPlan[] = {
    {"noise-pink-a", WAKE_CORPUS_NOISE, 3001u, 0.0f, 0.0f},
    {"noise-pink-b", WAKE_CORPUS_NOISE, 3002u, 0.0f, 0.0f},
    {"tone-440", WAKE_CORPUS_TONE, 2001u, 0.0f, 440.0f},
    {"tone-1200", WAKE_CORPUS_TONE, 2002u, 0.0f, 1200.0f},
    {"tone-2200", WAKE_CORPUS_TONE, 2003u, 0.0f, 2200.0f},
    {"tone-3000", WAKE_CORPUS_TONE, 2004u, 0.0f, 3000.0f},
    {"reverb-500", WAKE_CORPUS_REVERB_TONE, 4001u, 0.0f, 500.0f},
    {"reverb-700", WAKE_CORPUS_REVERB_TONE, 4002u, 0.0f, 700.0f},
};

/*
 * Fault injection for the negative control: turn correctly-rated 48 kHz audio
 * into 16 kHz audio *mislabeled* as 48 kHz, by decimating by 3 and holding.
 * That is exactly the state the pre-#244 device stage was actually in, and it is
 * what the model then received. Without this the "known-bad" stage is fed correct
 * audio and merely runs with a longer delay -- which is not a bug, and it passes,
 * which would leave the gate decorative.
 */
static void mislabel_as_48k(int16_t *buf, size_t n) {
  for (size_t i = 0; i + 3 < n; i += 3) {
    buf[i + 1] = buf[i];
    buf[i + 2] = buf[i];
  }
}

static int g_failures = 0;
static int16_t *g_clip = NULL;
static int16_t *g_out = NULL;

/* Run `ops` over the whole clip in place. Returns 0 on success. */
static int run_stage(const wake_afe_stage_ops_t *ops) {
  wake_afe_graph_t *g = wake_afe_graph_create();
  if (g == NULL) {
    return 1;
  }
  if (wake_afe_graph_append(g, ops) != 0) {
    wake_afe_graph_destroy(g);
    return 1;
  }
  int rc = 0;
  for (size_t off = 0; off + FRAME <= CLIP_SECONDS * SAMPLE_RATE; off += FRAME) {
    int16_t *channels[1] = {g_out + off};
    wake_afe_frame_t in;
    in.channels = channels;
    in.channel_count = 1;
    in.reference = NULL;
    in.reference_count = 0;
    in.frame_samples = FRAME;
    float vad = 0.0f;
    if (wake_afe_graph_process_frame(g, &in, &in, &vad) != 0) {
      rc = 1;
      break;
    }
  }
  wake_afe_graph_destroy(g);
  return rc;
}

static void failf(const char *clip, const char *what, double value,
                  const char *cmp, double limit) {
  printf("FAIL | %-12s %s: %.2f %s %.2f\n", clip, what, value, cmp, limit);
  ++g_failures;
}

int main(int argc, char **argv) {
  int known_bad = 0;
  for (int i = 1; i < argc; ++i) {
    if (strcmp(argv[i], "--known-bad") == 0) {
      known_bad = 1;
    }
  }
  const wake_afe_stage_ops_t *ops = known_bad ? &wake_quality_known_bad_ops
                                              : &wake_afe_ns_ops;

  const size_t n = (size_t)(CLIP_SECONDS * SAMPLE_RATE);
  g_clip = (int16_t *)calloc(n, sizeof(int16_t));
  g_out = (int16_t *)calloc(n, sizeof(int16_t));
  if (g_clip == NULL || g_out == NULL) {
    fprintf(stderr, "oom\n");
    return 2;
  }

  printf("# AFE quality harness (issue #247 slice A)\n");
  printf("# corpus: deterministic synthetic, %d clips x %.2f s @ %d Hz\n",
         (int)(sizeof(kPlan) / sizeof(kPlan[0])), CLIP_SECONDS, SAMPLE_RATE);
  printf("# mode: %s\n",
         known_bad ? "KNOWN-BAD (negative control, must FAIL)"
                   : "production");

  for (size_t c = 0; c < sizeof(kPlan) / sizeof(kPlan[0]); ++c) {
    const struct clip_plan *p = &kPlan[c];
    const int noise_only = (p->kind == WAKE_CORPUS_NOISE);

    /* Reference energy of the input, for a relative reading. */
    wake_corpus_render(g_clip, n, p->kind, p->seed, p->snr_db, p->freq_hz, 0.3f);
    if (known_bad) {
      mislabel_as_48k(g_clip, n); /* the injected fault */
    }
    const float in_dbfs = wake_quality_rms_dbfs(g_clip, n);

    memcpy(g_out, g_clip, n * sizeof(int16_t));
    if (run_stage(ops) != 0) {
      failf(p->name, "stage rejected the frame", 0, "!=", 0);
      continue;
    }
    const float out_dbfs = wake_quality_rms_dbfs(g_out, n);
    const float change_db = out_dbfs - in_dbfs;
    const float silent = wake_quality_silent_frame_ratio(g_out, n, FRAME, -70.0f);

    if (noise_only) {
      /* Residual against the input: this IS the residual noise. */
      const float residual_db = change_db;
      printf("ns | %-12s noise-only  in=%7.2fdBFS out=%7.2fdBFS residual=%7.2fdB "
             "silent=%.2f\n",
             p->name, (double)in_dbfs, (double)out_dbfs, (double)residual_db,
             (double)silent);
      if (!(residual_db < RESIDUAL_MAX_DB)) {
        failf(p->name, "noise residual too high", residual_db, ">=",
              RESIDUAL_MAX_DB);
      }
    } else {
      /* Clean signal must survive intact: no big loss, no pumping, no erasure. */
      printf("ns | %-12s clean       in=%7.2fdBFS out=%7.2fdBFS change=%7.2fdB "
             "silent=%.2f\n",
             p->name, (double)in_dbfs, (double)out_dbfs, (double)change_db,
             (double)silent);
      if (change_db < CLEAN_PRESERVE_MIN_DB) {
        failf(p->name, "clean signal attenuated", change_db, "<",
              CLEAN_PRESERVE_MIN_DB);
      }
      if (change_db > CLEAN_PRESERVE_MAX_DB) {
        failf(p->name, "clean signal amplified", change_db, ">",
              CLEAN_PRESERVE_MAX_DB);
      }
      if (silent > CLEAN_SILENT_MAX) {
        failf(p->name, "clean signal erased", silent, ">", CLEAN_SILENT_MAX);
      }
    }
  }

  free(g_clip);
  free(g_out);

  if (g_failures == 0) {
    printf("# RESULT: PASS\n");
    return known_bad ? 0 : 0;
  }
  printf("# RESULT: FAIL (%d)\n", g_failures);
  return 1;
}