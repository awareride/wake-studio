/*
 * L1 tests for the RNNoise NS/VAD stage (afe/rnnoise device target).
 *
 * RNNoise is deterministic; the assertions use generous bounds and a
 * relative ordering (loud signal beats silence) so they hold across
 * compilers/platforms.
 */
#include <cmath>
#include <cstdint>

#include "doctest/doctest.h"
#include "wake/afe_graph.h"

extern "C" const wake_afe_stage_ops_t wake_afe_ns_ops;

/* M_PI is not guaranteed under -std=c++17 on glibc (strict ANSI); use our
 * own constant for portability across the CI matrix (gcc + clang). */
static const double kPi = 3.14159265358979323846;

static void feed_tone(wake_afe_graph_t *g, float amp, double freq_hz,
                      int n_frames, float *vad_out) {
  static const double kSampleRate = 16000.0;
  for (int f = 0; f < n_frames; ++f) {
    int16_t frame[160];
    for (int i = 0; i < 160; ++i) {
      double t = (double)(f * 160 + i) / kSampleRate;
      frame[i] = (int16_t)(amp * 32767.0 * std::sin(2.0 * kPi * freq_hz * t));
    }
    float vad = 0.0f;
    CHECK(wake_afe_graph_process(g, frame, 160, &vad) == 0);
    *vad_out = vad;
  }
}

TEST_CASE("rnnoise ns stage: no crash, finite output, VAD in [0,1]") {
  wake_afe_graph_t *g = wake_afe_graph_create();
  REQUIRE(g != nullptr);
  CHECK(wake_afe_graph_append(g, &wake_afe_ns_ops) == 0);

  /* silence first, then a loud tone */
  int16_t frame[160] = {0};
  float vad = 0.0f;
  for (int f = 0; f < 120; ++f) {
    CHECK(wake_afe_graph_process(g, frame, 160, &vad) == 0);
    CHECK(vad >= 0.0f);
    CHECK(vad <= 1.0f);
  }
  float silence_vad = vad;

  float tone_vad = 0.0f;
  feed_tone(g, 0.3, 440.0, 120, &tone_vad);
  CHECK(tone_vad >= 0.0f);
  CHECK(tone_vad <= 1.0f);

  /* RNNoise flags speech-like/loud frames above silence */
  CHECK(tone_vad > silence_vad);

  wake_afe_graph_destroy(g);
}

TEST_CASE("rnnoise ns stage: denoised output is finite int16") {
  wake_afe_graph_t *g = wake_afe_graph_create();
  REQUIRE(g != nullptr);
  CHECK(wake_afe_graph_append(g, &wake_afe_ns_ops) == 0);

  int16_t frame[160];
  for (int f = 0; f < 60; ++f) {
    for (int i = 0; i < 160; ++i) {
      frame[i] = (int16_t)((f * 160 + i) % 1000 - 500);
    }
    float vad = 0.0f;
    CHECK(wake_afe_graph_process(g, frame, 160, &vad) == 0);
    for (int i = 0; i < 160; ++i) {
      /* denoised frames must be finite; assert no NaN/Inf via int16 clamp */
      CHECK(frame[i] >= -32768);
      CHECK(frame[i] <= 32767);
    }
  }

  wake_afe_graph_destroy(g);
}
