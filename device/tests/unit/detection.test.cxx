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

/* --- onset-safe VAD trigger gate (issue #241 B1) --------------------------- */

TEST_CASE("vad gate fails open when disabled or when no stage provides VAD") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  cfg.vad_gate_enabled = 0;
  wake_vad_gate_t *off = wake_vad_gate_create(&cfg);
  REQUIRE(off != nullptr);
  CHECK(wake_vad_gate_enabled(off) == 0);
  /* Even with vad=0 and a high score the gate never holds. */
  CHECK(wake_vad_gate_step(off, 1, 0.0f, 0.95f, 0.0) == WAKE_VAD_ALLOW);
  wake_vad_gate_destroy(off);

  cfg.vad_gate_enabled = 1;
  wake_vad_gate_t *g = wake_vad_gate_create(&cfg);
  REQUIRE(g != nullptr);
  /* vad_available == 0 (graph without a VAD-capable stage) -> fail open. */
  CHECK(wake_vad_gate_step(g, 0, 0.0f, 0.4f, 0.0) == WAKE_VAD_ALLOW);
  CHECK(wake_vad_gate_is_open(g) == 1);
  wake_vad_gate_destroy(g);
}

TEST_CASE("vad gate closes only after vad_close_ms of confirmed non-speech") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  cfg.vad_close_ms = 300;
  wake_vad_gate_t *g = wake_vad_gate_create(&cfg);
  REQUIRE(g != nullptr);

  CHECK(wake_vad_gate_step(g, 1, 0.9f, 0.1f, 0.0) == WAKE_VAD_ALLOW); /* speech */
  /* 299 ms of non-speech: hysteresis keeps it open (onset not clipped). */
  CHECK(wake_vad_gate_step(g, 1, 0.0f, 0.1f, 299.0) == WAKE_VAD_ALLOW);
  CHECK(wake_vad_gate_is_open(g) == 1);
  /* past the close window it closes. */
  CHECK(wake_vad_gate_step(g, 1, 0.0f, 0.1f, 300.0) == WAKE_VAD_HOLD);
  CHECK(wake_vad_gate_is_open(g) == 0);
  /* speech reopens it immediately. */
  CHECK(wake_vad_gate_step(g, 1, 0.9f, 0.1f, 310.0) == WAKE_VAD_ALLOW);
  CHECK(wake_vad_gate_is_open(g) == 1);
  wake_vad_gate_destroy(g);
}

TEST_CASE("vad gate bypasses very confident scores while closed") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  cfg.vad_close_ms = 0; /* close as soon as non-speech is seen */
  cfg.vad_hold_max_ms = 150;
  cfg.vad_high_confidence = 0.9f;
  wake_vad_gate_t *g = wake_vad_gate_create(&cfg);
  REQUIRE(g != nullptr);

  /* non-speech from a never-spoken gate: closed immediately */
  CHECK(wake_vad_gate_step(g, 1, 0.0f, 0.4f, 1000.0) == WAKE_VAD_HOLD);
  /* high confidence must publish regardless */
  CHECK(wake_vad_gate_step(g, 1, 0.0f, 0.95f, 1010.0) == WAKE_VAD_BYPASS);
  /* borderline stays held until the bounded delay expires, then fails open */
  CHECK(wake_vad_gate_step(g, 1, 0.0f, 0.5f, 1020.0) == WAKE_VAD_HOLD);
  CHECK(wake_vad_gate_hold_expired(g, 1169.0) == 0);
  CHECK(wake_vad_gate_hold_expired(g, 1170.0) == 1);
  CHECK(wake_vad_gate_step(g, 1, 0.0f, 0.5f, 1170.0) == WAKE_VAD_ALLOW);
  wake_vad_gate_destroy(g);
}

TEST_CASE("vad gate hold window is per event and never suppresses for ever") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  cfg.vad_close_ms = 0;
  cfg.vad_hold_max_ms = 100;
  wake_vad_gate_t *g = wake_vad_gate_create(&cfg);
  REQUIRE(g != nullptr);

  /* sustained borderline while closed: exactly one bounded delay, then open */
  CHECK(wake_vad_gate_step(g, 1, 0.0f, 0.5f, 0.0) == WAKE_VAD_HOLD);
  CHECK(wake_vad_gate_step(g, 1, 0.0f, 0.5f, 99.0) == WAKE_VAD_HOLD);
  CHECK(wake_vad_gate_step(g, 1, 0.0f, 0.5f, 100.0) == WAKE_VAD_ALLOW);
  /* a new event starts a fresh window */
  CHECK(wake_vad_gate_step(g, 1, 0.0f, 0.5f, 110.0) == WAKE_VAD_HOLD);
  CHECK(wake_vad_gate_step(g, 1, 0.0f, 0.5f, 210.0) == WAKE_VAD_ALLOW);
  wake_vad_gate_destroy(g);
}
