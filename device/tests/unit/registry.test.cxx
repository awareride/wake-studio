/*
 * L1 unit tests for the backend registry + capabilities
 * (wake/kws_backend.h, wake/capabilities.h).
 */
#include "doctest/doctest.h"
#include "wake/capabilities.h"
#include "wake/kws_backend.h"
#include "wake/sdk.h"

static int g_create_calls = 0;
static int g_load_calls = 0;

static void *fake_create(const wake_kws_config_t *) {
  ++g_create_calls;
  return reinterpret_cast<void *>(1);
}
static void fake_destroy(void *) {}
static int fake_load(void *, const wake_model_bundle_t *,
                     const wake_kws_config_t *) {
  ++g_load_calls;
  return 0;
}
static float fake_process(void *, const int16_t *, size_t) { return 0.7f; }
static void fake_reset(void *) {}

static const wake_kws_backend_ops_t kFakeOps = {
    "fake", "Fake Backend", fake_create, fake_destroy, fake_load, fake_process,
    fake_reset};

static wake_sdk_t *make_sdk() {
  wake_sdk_config_t scfg{};
  wake_sdk_t *sdk = wake_sdk_create(&scfg);
  REQUIRE(sdk != nullptr);
  return sdk;
}

TEST_CASE("backend registry registers, lists, and dedupes") {
  wake_sdk_t *sdk = make_sdk();

  CHECK(wake_sdk_register_kws_backend(sdk, &kFakeOps) == 0);
  CHECK(wake_sdk_backend_count(sdk) == 1);
  CHECK(wake_sdk_backend_at(sdk, 0) == &kFakeOps);
  CHECK(wake_sdk_backend_at(sdk, 1) == nullptr);
  CHECK(wake_sdk_backend_by_id(sdk, "fake") == &kFakeOps);
  CHECK(wake_sdk_backend_by_id(sdk, "nope") == nullptr);

  /* duplicates are ignored, registry unchanged */
  CHECK(wake_sdk_register_kws_backend(sdk, &kFakeOps) == 1);
  CHECK(wake_sdk_backend_count(sdk) == 1);

  wake_sdk_destroy(sdk);
}

TEST_CASE("capabilities reflect the build profile and registry") {
  wake_sdk_t *sdk = make_sdk();
  wake_sdk_register_kws_backend(sdk, &kFakeOps);

  wake_sdk_capabilities_t c = wake_sdk_capabilities(sdk);
  CHECK(c.backend_count == 1);
  CHECK(c.backend_ids != nullptr);
  CHECK(c.sample_rate_hz == 16000);
  CHECK(c.have_vad == 1);

#if defined(WAKE_SDK_PROFILE_APP)
  CHECK(c.have_threads == 1);
  CHECK(c.have_float_dsp == 1);
  CHECK(c.heap_budget_kb == 0);
#else
  CHECK(c.have_threads == 0);
  CHECK(c.have_float_dsp == 0);
  CHECK(c.heap_budget_kb == 256);
#endif

  wake_sdk_destroy(sdk);
}
