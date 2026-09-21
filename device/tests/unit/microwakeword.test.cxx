/*
 * L1 tests for the microwakeword driver contract (issue #185).
 *
 * Without WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME the driver must still create
 * and register, load() must fail loudly (runtime not linked), and
 * process_frame() must stay in warmup (-1) — never crash, never fabricate
 * a score.
 */
#include <cmath>
#include <string>
#include "doctest/doctest.h"
#include "wake/kws_backend.h"

extern "C" const wake_kws_backend_ops_t wake_kws_microwakeword_ops;

/* 10 ms @ 16 kHz — the SDK's AFE frame size (docs/modules/sdk.md §6). */
static const size_t kFrame = 160;
static const double kPi = 3.14159265358979323846;

static void mww_fill_sine(int16_t *frame, size_t n, double phase) {
  for (size_t i = 0; i < n; ++i) {
    double t = phase + (double)i / 16000.0;
    frame[i] = (int16_t)(0.3 * 32767.0 * std::sin(2.0 * kPi * 440.0 * t));
  }
}

#if !defined(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)

TEST_CASE("microwakeword driver: creates, load fails without runtime, warmup") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  const wake_kws_backend_ops_t *ops = &wake_kws_microwakeword_ops;
  CHECK(std::string(ops->id) == "microwakeword");

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

TEST_CASE("microwakeword driver: real streaming inference over okay_nabu") {
  const char *dir = std::getenv("WAKE_MICROWAKEWORD_MODEL_DIR");
#if defined(WAKE_MICROWAKEWORD_MODEL_DIR)
  if (dir == nullptr || *dir == '\0') {
    dir = WAKE_MICROWAKEWORD_MODEL_DIR;
  }
#endif
  if (dir == nullptr || *dir == '\0') {
    MESSAGE("WAKE_MICROWAKEWORD_MODEL_DIR unset - skipping real-inference "
            "assertions (CI stages okay_nabu.tflite as microwakeword.tflite)");
    return;
  }

  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  const wake_kws_backend_ops_t *ops = &wake_kws_microwakeword_ops;

  void *impl = ops->create(&cfg);
  REQUIRE(impl != nullptr);

  wake_model_bundle_t models;
  models.model_dir = dir;
  REQUIRE(ops->load(impl, &models, &cfg) == 0);

  /* 3 s of 440 Hz sine. The 30 ms frontend window needs 3 frames before the
   * first slice; after that every frame invokes and yields a finite [0,1]
   * posterior (the streaming graph carries its own history internally). */
  int16_t frame[kFrame];
  double phase = 0.0;
  int saw_score = 0;
  for (size_t t = 0; t < 48000 / kFrame; ++t) {
    mww_fill_sine(frame, kFrame, phase);
    phase += (double)kFrame / 16000.0;
    const float s = ops->process_frame(impl, frame, kFrame);
    if (s >= 0.0f) {
      saw_score = 1;
      CHECK(std::isfinite(s));
      CHECK(s >= 0.0f);
      CHECK(s <= 1.0f);
    }
  }
  CHECK(saw_score == 1); /* the pipeline must produce scores, not just warmup */

  /* A trailing silence second must stay finite too (no NaN creep). */
  int16_t quiet[kFrame] = {0};
  for (size_t t = 0; t < 16000 / kFrame; ++t) {
    const float s = ops->process_frame(impl, quiet, kFrame);
    if (s >= 0.0f) {
      CHECK(std::isfinite(s));
      CHECK(s >= 0.0f);
      CHECK(s <= 1.0f);
    }
  }

  /* reset() clears streaming state; the next frames are warmup again (the
   * frontend window refills), then finite scores resume. Note: reset is not
   * bit-identical to a fresh load by upstream design — FrontendReset has no
   * PCAN/log counterpart upstream (slow noise adaptation persists, which is
   * desirable across utterances), and interpreter Reset() zeroes variable
   * tensors while a fresh load runs the CALL_ONCE init subgraph. Neither
   * matters to the detection loop (smoothing/threshold over live audio);
   * ESPHome likewise never resets mid-stream state between utterances. */
  ops->reset(impl);
  CHECK(ops->process_frame(impl, frame, kFrame) == -1.0f); /* window refills */
  phase = 0.0;
  int resumed = 0;
  for (size_t t = 0; t < 48000 / kFrame; ++t) {
    mww_fill_sine(frame, kFrame, phase);
    phase += (double)kFrame / 16000.0;
    const float s = ops->process_frame(impl, frame, kFrame);
    if (s >= 0.0f) {
      resumed = 1;
      CHECK(std::isfinite(s));
      CHECK(s >= 0.0f);
      CHECK(s <= 1.0f);
    }
  }
  CHECK(resumed == 1);

  ops->destroy(impl);
}

#endif /* runtime linked */
