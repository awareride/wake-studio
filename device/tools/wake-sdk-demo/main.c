/*
 * wake-sdk-demo — host CLI demo (#182, ADR-040 §6 step 1).
 *
 * Composes the SDK (core + AFE stages + a backend), streams a WAV file
 * through the pipeline, prints score samples and trigger events.
 *
 * Usage: wake-sdk-demo <input.wav> [--threshold <t>] [--min-duration <ms>]
 *                       [--cooldown <ms>] [--vad-off]
 *
 * Exit code: 0 when the wake word triggers at least once, 1 otherwise
 * (usable as a CI smoke gate).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "wake/afe_graph.h"
#include "wake/detection.h"
#include "wake/kws_backend.h"
#include "wake/pipeline.h"
#include "wake/sdk.h"

#include "host/wav_reader.h"
#include "wake/resample.h"

/* the reference composition root (ADR-040 §3): one line per module */
extern void wake_sdk_compose(wake_sdk_t *sdk);

/* The pipeline is fed at the AFE-internal rate (#245 slice C): 480 @
 * 48 kHz. It downsamples once at the KWS boundary, so the wav is still read at
 * 16 kHz and only the framing changes. */
#define FRAME WAKE_AFE_GRAPH_FRAME_SAMPLES
#define FRAME_RATE_HZ WAKE_AFE_GRAPH_SAMPLE_RATE_HZ

static float parse_float(const char *s) { return (float)atof(s); }

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr,
            "usage: wake-sdk-demo <input.wav> [--threshold <t>] "
            "[--min-duration <ms>] [--cooldown <ms>] [--vad-off]\n");
    return 2;
  }

  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  int vad_gate = 1;
  for (int i = 2; i < argc; ++i) {
    if (strcmp(argv[i], "--threshold") == 0 && i + 1 < argc) {
      cfg.threshold = parse_float(argv[++i]);
    } else if (strcmp(argv[i], "--min-duration") == 0 && i + 1 < argc) {
      cfg.min_duration_ms = (unsigned)atoi(argv[++i]);
    } else if (strcmp(argv[i], "--cooldown") == 0 && i + 1 < argc) {
      cfg.cooldown_ms = (unsigned)atoi(argv[++i]);
    } else if (strcmp(argv[i], "--vad-off") == 0) {
      vad_gate = 0;
    } else {
      fprintf(stderr, "unknown option: %s\n", argv[i]);
      return 2;
    }
  }
  cfg.vad_gate_enabled = vad_gate;

  wake_wav_t wav;
  if (wake_wav_open(argv[1], &wav) != 0) {
    fprintf(stderr, "cannot read wav (PCM16 RIFF required): %s\n", argv[1]);
    return 2;
  }
  if (wav.sample_rate != 16000) {
    fprintf(stderr, "unsupported sample rate %d Hz (16 kHz required)\n",
            wav.sample_rate);
    wake_wav_close(&wav);
    return 2;
  }
  fprintf(stderr, "wav: %zu mono samples @ %d Hz (%zu s)\n", wav.sample_count,
          wav.sample_rate, wav.sample_count / wav.sample_rate);

  /* --- compose the SDK (ADR-040 §3: one line per module in the root) --- */
  wake_sdk_config_t scfg = {0};
  wake_sdk_t *sdk = wake_sdk_create(&scfg);
  wake_sdk_compose(sdk);

  wake_pipeline_t *pipe =
      wake_pipeline_create(sdk, "rms", &cfg, NULL);
  if (pipe == NULL) {
    fprintf(stderr, "pipeline create failed\n");
    wake_sdk_destroy(sdk);
    wake_wav_close(&wav);
    return 2;
  }

  /*
   * The wav is read at 16 kHz but the pipeline is fed at the AFE-internal rate
   * (#245 slice C). A real device captures at 48 kHz directly; this demo
   * converts explicitly so the file stays 16 kHz, using the same core converter
   * the pipeline itself uses. The pipeline downsamples back to 16 kHz at the KWS
   * boundary, so the round trip is symmetric.
   */
  wake_resampler_t *to_afe =
      wake_resampler_create(WAKE_SDK_KWS_SAMPLE_RATE_HZ, WAKE_AFE_GRAPH_SAMPLE_RATE_HZ);
  if (to_afe == NULL) {
    fprintf(stderr, "resampler create failed\n");
    wake_pipeline_destroy(pipe);
    wake_sdk_destroy(sdk);
    wake_wav_close(&wav);
    return 2;
  }

  int triggered = 0;
  int16_t frame[FRAME];
  size_t pos = 0;
  size_t frame_idx = 0;
  while (pos < wav.sample_count) {
    /* Gather one 10 ms window at the KWS rate, then convert up. */
    int16_t kws_frame[WAKE_SDK_KWS_FRAME_SAMPLES];
    size_t n = wav.sample_count - pos;
    if (n > WAKE_SDK_KWS_FRAME_SAMPLES) n = WAKE_SDK_KWS_FRAME_SAMPLES;
    for (size_t i = 0; i < n; ++i) kws_frame[i] = wav.samples[pos + i];
    for (size_t i = n; i < WAKE_SDK_KWS_FRAME_SAMPLES; ++i) kws_frame[i] = 0;

    size_t up_n = 0;
    if (wake_resampler_process(to_afe, kws_frame, WAKE_SDK_KWS_FRAME_SAMPLES,
                               frame, &up_n) != 0 ||
        up_n != FRAME) {
      fprintf(stderr, "resample failed\n");
      break;
    }
    pos += WAKE_SDK_KWS_FRAME_SAMPLES;

    wake_score_sample_t out;
    wake_trigger_event_t ev;
    wake_pipeline_process(pipe, frame, FRAME, (double)(frame_idx * 10), &out,
                          &ev);

    if (frame_idx % 10 == 0) {
      printf("t=%7.1fms score=%5.3f smooth=%5.3f vad=%5.3f%s\n",
             out.captured_at_ms, out.raw_score, out.smoothed_score,
             out.vad_probability, out.triggered ? "  <--" : "");
    }
    if (out.triggered) {
      printf("TRIGGER at %.1f ms, peak %.3f, word '%s'\n", ev.triggered_at_ms,
             ev.peak_score, ev.word);
      triggered = 1;
    }
    pos += n;
    frame_idx += 1;
  }

  wake_resampler_destroy(to_afe);
  wake_pipeline_destroy(pipe);
  wake_sdk_destroy(sdk);
  wake_wav_close(&wav);

  if (!triggered) {
    fprintf(stderr, "no trigger (threshold %.2f, min %u ms)\n", cfg.threshold,
            cfg.min_duration_ms);
  }
  return triggered ? 0 : 1;
}
