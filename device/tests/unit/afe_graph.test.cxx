/*
 * L1 unit tests for the AFE graph + passthrough stages
 * (wake/afe_graph.h, afe/aec + afe/bss device targets).
 */
#include <cstdint>
#include <cstring>

#include "doctest/doctest.h"
#include "wake/afe_graph.h"
#include "wake/sdk.h"

/* module-provided stage ops (link wake_afe_aec / wake_afe_bss) */
extern "C" const wake_afe_stage_ops_t wake_afe_aec_ops;
extern "C" const wake_afe_stage_ops_t wake_afe_bss_ops;

static wake_sdk_t *make_sdk() {
  wake_sdk_config_t scfg{};
  wake_sdk_t *sdk = wake_sdk_create(&scfg);
  REQUIRE(sdk != nullptr);
  return sdk;
}

TEST_CASE("stage registry registers and dedupes (aec + bss)") {
  wake_sdk_t *sdk = make_sdk();
  CHECK(wake_sdk_register_afe_stage(sdk, &wake_afe_aec_ops) == 0);
  CHECK(wake_sdk_register_afe_stage(sdk, &wake_afe_bss_ops) == 0);
  CHECK(wake_sdk_stage_count(sdk) == 2);
  CHECK(wake_sdk_stage_by_id(sdk, "aec") == &wake_afe_aec_ops);
  CHECK(wake_sdk_stage_by_id(sdk, "bss") == &wake_afe_bss_ops);
  CHECK(wake_sdk_stage_by_id(sdk, "ns") == nullptr);
  CHECK(wake_sdk_register_afe_stage(sdk, &wake_afe_aec_ops) == 1); /* dup */
  CHECK(wake_sdk_stage_count(sdk) == 2);
  wake_sdk_destroy(sdk);
}

TEST_CASE("graph runs passthrough stages in order without corruption") {
  wake_afe_graph_t *g = wake_afe_graph_create();
  REQUIRE(g != nullptr);
  CHECK(wake_afe_graph_append(g, &wake_afe_aec_ops) == 0);
  CHECK(wake_afe_graph_append(g, &wake_afe_bss_ops) == 0);

  int16_t frame[160];
  for (int i = 0; i < 160; ++i) frame[i] = (int16_t)(i * 100 - 8000);

  int16_t before[160];
  std::memcpy(before, frame, sizeof(frame));

  float vad = -1.0f;
  CHECK(wake_afe_graph_process(g, frame, 160, &vad) == 0);
  /* passthrough: output identical, no VAD provided -> 0 */
  CHECK(std::memcmp(frame, before, sizeof(frame)) == 0);
  CHECK(vad == doctest::Approx(0.0f));

  wake_afe_graph_reset(g);
  wake_afe_graph_destroy(g);
}

TEST_CASE("graph propagates a stage's VAD probability") {
  /* fake VAD stage */
  static int fake_vad_calls = 0;
  struct fake_vad {
    float vad;
  };
  auto fake_create = []() -> void * {
    auto *f = new fake_vad;
    f->vad = 0.77f;
    return f;
  };
  auto fake_destroy = [](void *v) { delete static_cast<fake_vad *>(v); };
  auto fake_process = [](void *v, int16_t *, size_t, float *vad_out) {
    ++fake_vad_calls;
    if (vad_out) *vad_out = static_cast<fake_vad *>(v)->vad;
    return 0;
  };
  auto fake_reset = [](void *) {};
  /* Declares the graph's own rate, so it is driven directly (#245). */
  static const wake_afe_stage_ops_t fake_vad_ops = {
      "fake-vad", "Fake VAD", fake_create, fake_destroy, fake_process,
      fake_reset, 1, WAKE_AFE_GRAPH_SAMPLE_RATE_HZ, WAKE_AFE_GRAPH_FRAME_SAMPLES};

  wake_afe_graph_t *g = wake_afe_graph_create();
  REQUIRE(g != nullptr);
  CHECK(wake_afe_graph_append(g, &wake_afe_aec_ops) == 0);
  CHECK(wake_afe_graph_append(g, &fake_vad_ops) == 0);

  int16_t frame[160] = {0};
  float vad = 0.0f;
  CHECK(wake_afe_graph_process(g, frame, 160, &vad) == 0);
  CHECK(vad == doctest::Approx(0.77f));
  CHECK(fake_vad_calls == 1);

  wake_afe_graph_destroy(g);
}

/* --- declared sample-rate contract (issue #245) --------------------------- */

namespace {

/* A stage that records the frame size the graph hands it. */
struct rate_probe {
  size_t last_n;
  int calls;
};

void *rate_create(void *) { return nullptr; }
/* The most recently created instance, so a test can inspect what the graph
 * actually handed the stage. */
static rate_probe *g_last_probe = nullptr;

void *rate_probe_create() {
  auto *p = new rate_probe;
  p->last_n = 0;
  p->calls = 0;
  g_last_probe = p;
  return p;
}
void rate_probe_destroy(void *v) { delete static_cast<rate_probe *>(v); }
int rate_probe_process(void *v, int16_t *, size_t n, float *vad_out) {
  auto *p = static_cast<rate_probe *>(v);
  p->last_n = n;
  p->calls += 1;
  if (vad_out) *vad_out = 0.5f;
  return 0;
}
void rate_probe_reset(void *) {}

} // namespace

TEST_CASE("graph rejects a stage that does not declare its rate") {
  static const wake_afe_stage_ops_t undeclared = {
      "undeclared", "no rate", rate_probe_create, rate_probe_destroy,
      rate_probe_process, rate_probe_reset, 0, 0u, 0u};
  wake_afe_graph_t *g = wake_afe_graph_create();
  REQUIRE(g != nullptr);
  // Silently driving a stage whose rate is unknown is the #240 B2 failure mode.
  CHECK(wake_afe_graph_append(g, &undeclared) == 1);
  CHECK(wake_afe_graph_has_vad(g) == 0);
  wake_afe_graph_destroy(g);
}

TEST_CASE("graph rejects a non-integer rate ratio") {
  static const wake_afe_stage_ops_t odd_rate = {
      "odd", "44.1 kHz", rate_probe_create, rate_probe_destroy,
      rate_probe_process, rate_probe_reset, 0, 44100u, 441u};
  wake_afe_graph_t *g = wake_afe_graph_create();
  REQUIRE(g != nullptr);
  CHECK(wake_afe_graph_append(g, &odd_rate) == 1);
  wake_afe_graph_destroy(g);
}

TEST_CASE("graph rejects a frame whose duration does not match") {
  // 320 samples @ 48 kHz is not the same 10 ms as the graph's 160 @ 16 kHz.
  static const wake_afe_stage_ops_t wrong_frame = {
      "wrong", "wrong frame", rate_probe_create, rate_probe_destroy,
      rate_probe_process, rate_probe_reset, 0, 48000u, 320u};
  wake_afe_graph_t *g = wake_afe_graph_create();
  REQUIRE(g != nullptr);
  CHECK(wake_afe_graph_append(g, &wrong_frame) == 1);
  wake_afe_graph_destroy(g);
}

TEST_CASE("graph converts a stage that declares a different rate") {
  static const wake_afe_stage_ops_t fast = {
      "fast", "48 kHz stage", rate_probe_create, rate_probe_destroy,
      rate_probe_process, rate_probe_reset, 1, 48000u, 480u};

  wake_afe_graph_t *g = wake_afe_graph_create();
  REQUIRE(g != nullptr);
  CHECK(wake_afe_graph_append(g, &fast) == 0);
  CHECK(wake_afe_graph_has_vad(g) == 1);

  int16_t frame[160];
  for (int i = 0; i < 160; ++i) frame[i] = (int16_t)(i * 200 - 16000);
  float vad = 0.0f;
  // The stage is handed 480 samples (10 ms @ 48 kHz) for our 160-sample frame,
  // and the graph converts back so the caller still sees exactly 160.
  for (int f = 0; f < 4; ++f) {
    CHECK(wake_afe_graph_process(g, frame, 160, &vad) == 0);
  }
  CHECK(vad == doctest::Approx(0.5f));
  REQUIRE(g_last_probe != nullptr);
  CHECK(g_last_probe->calls == 4);
  CHECK(g_last_probe->last_n == 480); // 10 ms @ 48 kHz, exactly

  wake_afe_graph_destroy(g);
}

TEST_CASE("a stage declaring the graph rate is called directly") {
  // Passthrough stages must pay no conversion cost: the fake stage sees exactly
  // the caller's frame size.
  static const wake_afe_stage_ops_t same = {
      "same", "graph rate", rate_probe_create, rate_probe_destroy,
      rate_probe_process, rate_probe_reset, 0, WAKE_AFE_GRAPH_SAMPLE_RATE_HZ,
      WAKE_AFE_GRAPH_FRAME_SAMPLES};
  wake_afe_graph_t *g = wake_afe_graph_create();
  REQUIRE(g != nullptr);
  CHECK(wake_afe_graph_append(g, &same) == 0);
  int16_t frame[160] = {0};
  float vad = 0.0f;
  CHECK(wake_afe_graph_process(g, frame, 160, &vad) == 0);
  REQUIRE(g_last_probe != nullptr);
  CHECK(g_last_probe->calls == 1);
  CHECK(g_last_probe->last_n == 160);
  wake_afe_graph_destroy(g);
}
