/*
 * L1 tests for the microwakeword driver contract (issue #185).
 *
 * Without WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME the driver must still create
 * and register, load() must fail loudly (runtime not linked), and
 * process_frame() must stay in warmup (-1) — never crash, never fabricate
 * a score.
 */
#include "doctest/doctest.h"
#include "wake/kws_backend.h"

extern "C" const wake_kws_backend_ops_t wake_kws_microwakeword_ops;

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
  int16_t frame[160] = {0};
  CHECK(ops->process_frame(impl, frame, 160) == -1.0f);

  ops->reset(impl);
  ops->destroy(impl);
}
