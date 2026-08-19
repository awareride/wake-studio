/*
 * L1 unit tests for the detection loop (wake/detection.h) — port fidelity
 * tests against packages/modules/kws/engine/core/logic.ts behaviour.
 */
#include <string>

#include "doctest/doctest.h"
#include "wake/detection.h"

TEST_CASE("score smoother max-pools over the window") {
  wake_score_smoother_t *s = wake_score_smoother_create(3);
  REQUIRE(s != nullptr);

  CHECK(wake_score_smoother_push(s, 0.2f) == doctest::Approx(0.2f));
  CHECK(wake_score_smoother_push(s, 0.9f) == doctest::Approx(0.9f));
  CHECK(wake_score_smoother_push(s, 0.3f) == doctest::Approx(0.9f));
  /* window slides: 0.2 leaves, so max over {0.9, 0.3, 0.1} = 0.9 */
  CHECK(wake_score_smoother_push(s, 0.1f) == doctest::Approx(0.9f));
  /* max over {0.3, 0.1, 0.05} = 0.3 */
  CHECK(wake_score_smoother_push(s, 0.05f) == doctest::Approx(0.3f));

  wake_score_smoother_destroy(s);
}

TEST_CASE("score smoother warms up after a full window") {
  wake_score_smoother_t *s = wake_score_smoother_create(2);
  REQUIRE(s != nullptr);
  CHECK_FALSE(wake_score_smoother_warmed(s));
  wake_score_smoother_push(s, 0.1f);
  CHECK_FALSE(wake_score_smoother_warmed(s));
  wake_score_smoother_push(s, 0.2f);
  CHECK(wake_score_smoother_warmed(s));

  wake_score_smoother_reset(s);
  CHECK_FALSE(wake_score_smoother_warmed(s));
  wake_score_smoother_destroy(s);
}

TEST_CASE("trigger detector fires only after min-duration above threshold") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  cfg.threshold = 0.5f;
  cfg.min_duration_ms = 300;
  cfg.cooldown_ms = 2000;

  wake_trigger_detector_t *d = wake_trigger_detector_create(&cfg, "hey");
  REQUIRE(d != nullptr);

  wake_trigger_event_t ev{};
  CHECK_FALSE(wake_trigger_detector_process(d, 0.9f, 0.0, &ev));
  CHECK_FALSE(wake_trigger_detector_process(d, 0.9f, 200.0, &ev));
  CHECK(wake_trigger_detector_process(d, 0.9f, 300.0, &ev));
  CHECK(ev.triggered_at_ms == doctest::Approx(300.0));
  CHECK(ev.peak_score == doctest::Approx(0.9f));
  CHECK(std::string(ev.word) == "hey");

  /* cooldown: an immediate re-trigger is blocked even though duration is met */
  CHECK_FALSE(wake_trigger_detector_process(d, 0.9f, 350.0, &ev));
  /* after cooldown elapses (still above since t=0), a trigger fires again */
  CHECK(wake_trigger_detector_process(d, 0.9f, 2300.0, &ev));

  wake_trigger_detector_destroy(d);
}

TEST_CASE("trigger detector restarts duration when score drops below") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  cfg.threshold = 0.5f;
  cfg.min_duration_ms = 100;
  cfg.cooldown_ms = 2000;

  wake_trigger_detector_t *d = wake_trigger_detector_create(&cfg, nullptr);
  REQUIRE(d != nullptr);

  wake_trigger_event_t ev{};
  CHECK_FALSE(wake_trigger_detector_process(d, 0.9f, 0.0, &ev));  /* track */
  wake_trigger_detector_process(d, 0.2f, 50.0, &ev);              /* drop */
  CHECK_FALSE(wake_trigger_detector_process(d, 0.9f, 100.0, &ev)); /* re-enter */
  CHECK(wake_trigger_detector_process(d, 0.9f, 200.0, &ev));      /* 100ms */

  wake_trigger_detector_reset(d);
  CHECK_FALSE(wake_trigger_detector_process(d, 0.9f, 210.0, &ev)); /* fresh */

  wake_trigger_detector_destroy(d);
}

TEST_CASE("vad gate mirrors shouldGateByVad") {
  CHECK(wake_should_gate_by_vad(0.1f, 0.3f, 1) == 1);  /* below -> gated */
  CHECK(wake_should_gate_by_vad(0.5f, 0.3f, 1) == 0);
  CHECK(wake_should_gate_by_vad(0.1f, 0.3f, 0) == 0);  /* disabled -> never */
}
