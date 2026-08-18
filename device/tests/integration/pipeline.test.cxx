/*
 * Composition-root integration test (#182): core + AFE stages (aec/bss/ns)
 * + the RMS reference backend + detection loop, wav-in → trigger asserted.
 * This is the L2-style boot test for the device world (ADR-026).
 */
#include <cmath>
#include <cstdint>
#include <cstring>

#include "doctest/doctest.h"
#include "wake/afe_graph.h"
#include "wake/capabilities.h"
#include "wake/kws_backend.h"
#include "wake/pipeline.h"
#include "wake/sdk.h"

/* the reference composition root (ADR-040 §3) */
extern "C" void wake_sdk_compose(wake_sdk_t *sdk);

static const double kPi = 3.14159265358979323846;

static wake_pipeline_t *compose(const wake_kws_config_t *cfg) {
  wake_sdk_config_t scfg{};
  wake_sdk_t *sdk = wake_sdk_create(&scfg);
  REQUIRE(sdk != nullptr);
  wake_sdk_compose(sdk); /* one line per module (ADR-040 §3) */

  wake_pipeline_t *pipe = wake_pipeline_create(sdk, "rms", cfg, nullptr);
  REQUIRE(pipe != nullptr);
  return pipe;
}

TEST_CASE("composition root registers the host module set") {
  wake_sdk_config_t scfg{};
  wake_sdk_t *sdk = wake_sdk_create(&scfg);
  REQUIRE(sdk != nullptr);
  wake_sdk_compose(sdk);

  CHECK(wake_sdk_backend_count(sdk) == 1);
  CHECK(wake_sdk_backend_by_id(sdk, "rms") != nullptr);
  CHECK(wake_sdk_stage_count(sdk) == 3);
  CHECK(wake_sdk_stage_by_id(sdk, "aec") != nullptr);
  CHECK(wake_sdk_stage_by_id(sdk, "bss") != nullptr);
  CHECK(wake_sdk_stage_by_id(sdk, "ns") != nullptr);

  wake_sdk_capabilities_t c = wake_sdk_capabilities(sdk);
  CHECK(c.backend_count == 1);
  CHECK(c.sample_rate_hz == 16000);

  wake_sdk_destroy(sdk);
}

/* Feed n_frames of a tone (amp 0..1, 440 Hz); returns trigger count. */
static int feed_tone(wake_pipeline_t *pipe, float amp, int n_frames,
                     wake_trigger_event_t *first_ev) {
  int triggers = 0;
  for (int f = 0; f < n_frames; ++f) {
    int16_t frame[160];
    for (int i = 0; i < 160; ++i) {
      double t = (double)(f * 160 + i) / 16000.0;
      frame[i] = (int16_t)(amp * 32767.0 * std::sin(2.0 * kPi * 440.0 * t));
    }
    wake_score_sample_t out;
    wake_trigger_event_t ev;
    CHECK(wake_pipeline_process(pipe, frame, 160, (double)(f * 10), &out,
                                &ev) == 0);
    if (out.triggered) {
      if (triggers == 0 && first_ev) *first_ev = ev;
      triggers += 1;
    }
  }
  return triggers;
}

static int feed_silence(wake_pipeline_t *pipe, int n_frames) {
  int16_t frame[160] = {0};
  int triggers = 0;
  for (int f = 0; f < n_frames; ++f) {
    wake_score_sample_t out;
    wake_trigger_event_t ev;
    CHECK(wake_pipeline_process(pipe, frame, 160, (double)(f * 10), &out,
                                &ev) == 0);
    triggers += out.triggered ? 1 : 0;
  }
  return triggers;
}

TEST_CASE("pipeline triggers on a loud tone and not on silence") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  cfg.threshold = 0.5f;
  cfg.min_duration_ms = 300;
  cfg.cooldown_ms = 2000;
  cfg.smoothing_window_frames = 5;
  cfg.vad_gate_enabled = 1; /* rnnoise VAD from the NS stage */

  wake_pipeline_t *pipe = compose(&cfg);
  REQUIRE(pipe != nullptr);

  /* silence first: must not trigger; VAD gates ~0 scores */
  CHECK(feed_silence(pipe, 100) == 0);

  /* loud tone for 3 s: must trigger at least once (min-duration + cooldown
   * bound the rate; cooldown 2 s over 3 s of audio allows 1..2 triggers) */
  wake_trigger_event_t first{};
  int triggers = feed_tone(pipe, 0.3f, 300, &first);
  CHECK(triggers >= 1);
  CHECK(first.peak_score >= cfg.threshold);
  CHECK(std::string(first.word) == "RMS reference (host demo)");

  /* silence after the burst: no new triggers while gated */
  CHECK(feed_silence(pipe, 100) == 0);

  wake_pipeline_destroy(pipe);
}

TEST_CASE("pipeline respects the vad gate: quiet audio stays silent") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  cfg.threshold = 0.5f;
  cfg.vad_gate_enabled = 1;

  wake_pipeline_t *pipe = compose(&cfg);
  REQUIRE(pipe != nullptr);

  /* very quiet tone (amp 0.02): rnnoise VAD stays low -> gated, no trigger */
  int triggers = feed_tone(pipe, 0.02f, 200, nullptr);
  CHECK(triggers == 0);

  wake_pipeline_destroy(pipe);
}

TEST_CASE("pipeline cooldown blocks re-trigger bursts") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  cfg.threshold = 0.5f;
  cfg.min_duration_ms = 100;
  cfg.cooldown_ms = 2000;

  wake_pipeline_t *pipe = compose(&cfg);
  REQUIRE(pipe != nullptr);

  /* sustained loud audio for 3 s with a short min-duration: triggers should
   * be sparse (cooldown-gated), roughly 1 per 2 s */
  int triggers = feed_tone(pipe, 0.3f, 300, nullptr);
  CHECK(triggers >= 1);
  CHECK(triggers <= 2);

  wake_pipeline_destroy(pipe);
}
