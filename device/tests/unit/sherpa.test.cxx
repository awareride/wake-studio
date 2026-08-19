/*
 * L1 tests for the sherpa-onnx KWS driver contract (issue #193).
 *
 * Without WAKE_SDK_SHERPA_HAS_RUNTIME the driver must still create and
 * register, load() must fail loudly (runtime not linked), and
 * process_frame() must stay in warmup (-1) — never crash, never fabricate a
 * score.
 *
 * With the runtime + a model dir (WAKE_SHERPA_MODEL_DIR, set by CI): the
 * real KWS transducer runs over a genuine wake-word clip — a hit (1.0 held)
 * must appear for trigger.wav and never for silence; semantics mirror the
 * browser driver (packages/modules/kws/sherpa/core/backend.ts).
 */
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "doctest/doctest.h"
#include "wake/kws_backend.h"
#include "wav_reader.h"

extern "C" const wake_kws_backend_ops_t wake_kws_sherpa_ops;

/* 10 ms @ 16 kHz — the SDK's AFE frame size (docs/modules/sdk.md §6). */
static const size_t kFrame = 160;

#if !defined(WAKE_SDK_SHERPA_HAS_RUNTIME)

TEST_CASE("sherpa driver: creates, load fails without runtime, warmup") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  const wake_kws_backend_ops_t *ops = &wake_kws_sherpa_ops;
  CHECK(std::string(ops->id) == "sherpa-onnx-kws");

  void *impl = ops->create(&cfg);
  REQUIRE(impl != nullptr);

  /* no runtime in this build (default) -> load must fail loudly */
  wake_model_bundle_t models;
  models.model_dir = "/nonexistent";
  CHECK(ops->load(impl, &models, &cfg) != 0);

  /* warmup: -1, never a fabricated score */
  int16_t frame[kFrame] = {0};
  CHECK(ops->process_frame(impl, frame, kFrame) == -1.0f);

  ops->reset(impl);
  ops->destroy(impl);
}

#else /* runtime linked */

/* Feed a whole wav through the driver; returns the number of hit frames
 * (1.0) and the number of invalid scores seen. */
static void feed_wav(const wake_kws_backend_ops_t *ops, void *impl,
                     const char *path, int *hits, int *bad) {
  wake_wav_t wav;
  *hits = 0;
  *bad = 0;
  if (wake_wav_open(path, &wav) != 0) {
    MESSAGE("cannot open " << path << " - skipping");
    return;
  }
  REQUIRE(wav.sample_rate == 16000);
  REQUIRE(wav.channels == 1);

  size_t i = 0;
  while (i < wav.sample_count) {
    size_t n = wav.sample_count - i < kFrame ? wav.sample_count - i : kFrame;
    const float s = ops->process_frame(impl, wav.samples + i, n);
    if (s == 1.0f) {
      (*hits)++;
    } else if (s < 0.0f || s > 1.0f) {
      (*bad)++;
    }
    i += n;
  }
  wake_wav_close(&wav);
}

TEST_CASE("sherpa driver: real transducer hits on the wake-word clip") {
  const char *dir = std::getenv("WAKE_SHERPA_MODEL_DIR");
#if defined(WAKE_SHERPA_MODEL_DIR)
  if (dir == nullptr || *dir == '\0') {
    dir = WAKE_SHERPA_MODEL_DIR;
  }
#endif
  if (dir == nullptr || *dir == '\0') {
    MESSAGE("WAKE_SHERPA_MODEL_DIR unset - skipping real-inference "
            "assertions (CI sets it from the fetched kws model)");
    return;
  }

  /* Skip when the model files are absent (issue #193 acceptance). */
  {
    std::string model = std::string(dir) + "/encoder.onnx";
    std::string trigger = std::string(dir) + "/trigger.wav";
    FILE *m = fopen(model.c_str(), "rb");
    FILE *t = fopen(trigger.c_str(), "rb");
    if (m == nullptr || t == nullptr) {
      if (m != nullptr) fclose(m);
      if (t != nullptr) fclose(t);
      MESSAGE("sherpa model files / trigger.wav absent in " << dir
              << " - skipping real-inference assertions");
      return;
    }
    fclose(m);
    fclose(t);
  }

  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  const wake_kws_backend_ops_t *ops = &wake_kws_sherpa_ops;

  void *impl = ops->create(&cfg);
  REQUIRE(impl != nullptr);

  wake_model_bundle_t models;
  models.model_dir = dir;
  REQUIRE(ops->load(impl, &models, &cfg) == 0);

  /* A real wake-word clip must produce at least one held 1.0 hit, and every
   * score must be a valid 0.0/1.0 (never NaN or out of range). */
  int hits = 0, bad = 0;
  feed_wav(ops, impl, (std::string(dir) + "/trigger.wav").c_str(), &hits, &bad);
  CHECK(bad == 0);
  CHECK(hits > 0); /* the transducer must fire on the keyword clip */

  /* Silence must never trigger. */
  ops->reset(impl);
  int16_t quiet[kFrame] = {0};
  for (size_t t = 0; t < 16000 / kFrame; ++t) {
    const float s = ops->process_frame(impl, quiet, kFrame);
    CHECK(s == 0.0f || s == 1.0f);
    CHECK(s != 1.0f);
  }

  /* reset() clears the hold; the next frame is a clean 0.0 (no hit). */
  ops->reset(impl);
  CHECK(ops->process_frame(impl, quiet, kFrame) == 0.0f);

  ops->destroy(impl);
}

#endif /* runtime linked */
