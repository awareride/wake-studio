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
  static const wake_afe_stage_ops_t fake_vad_ops = {
      "fake-vad", "Fake VAD", fake_create, fake_destroy, fake_process,
      fake_reset};

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
