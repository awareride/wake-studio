/*
 * L1 tests for the plix driver contract (issue #188).
 *
 * Without WAKE_SDK_PLIX_HAS_RUNTIME the driver must still create and
 * register, load() must fail loudly (runtime not linked), and
 * process_frame() must stay in warmup (-1) — never crash, never fabricate
 * a score.
 *
 * With the runtime + a model dir (WAKE_PLIX_MODEL_DIR, set by CI): load()
 * opens the encoder session by file path (external .data resolves), the
 * [1,1,64,100] contract is verified, and frames stay in warmup until the
 * slice-2 frontend lands.
 */
#include <cstdlib>
#include <string>
#include "doctest/doctest.h"
#include "wake/kws_backend.h"

extern "C" const wake_kws_backend_ops_t wake_kws_plix_ops;

TEST_CASE("plix driver: creates, registers, warmup contract") {
  wake_kws_config_t cfg = WAKE_KWS_CONFIG_DEFAULT;
  const wake_kws_backend_ops_t *ops = &wake_kws_plix_ops;
  CHECK(std::string(ops->id) == "plixkws");

  void *impl = ops->create(&cfg);
  REQUIRE(impl != nullptr);

#if !defined(WAKE_SDK_PLIX_HAS_RUNTIME)
  /* no runtime in this build (default) -> load must fail loudly */
  wake_model_bundle_t models;
  models.model_dir = "/nonexistent";
  CHECK(ops->load(impl, &models, &cfg) != 0);
#endif

#if defined(WAKE_SDK_PLIX_HAS_RUNTIME)
  const char *dir = std::getenv("WAKE_PLIX_MODEL_DIR");
#if defined(WAKE_PLIX_MODEL_DIR)
  if (dir == nullptr || *dir == '\0') {
    dir = WAKE_PLIX_MODEL_DIR;
  }
#endif
  if (dir == nullptr || *dir == '\0') {
    MESSAGE("WAKE_PLIX_MODEL_DIR unset - skipping load assertions (CI "
            "stages plixkws-small.onnx + .data)");
    ops->destroy(impl);
    return;
  }
  wake_model_bundle_t models;
  models.model_dir = dir;
  CHECK(ops->load(impl, &models, &cfg) == 0);
#endif

  /* warmup: -1 until the slice-2 frontend lands — never a fabricated score */
  int16_t frame[160] = {0};
  CHECK(ops->process_frame(impl, frame, 160) == -1.0f);

  ops->reset(impl);
  ops->destroy(impl);
}
