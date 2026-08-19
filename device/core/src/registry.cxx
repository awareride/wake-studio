/*
 * registry.cxx — KWS backend registry (ADR-020/024) + capability query.
 *
 * Modules register via the composition root (ADR-040 §3): adding a backend is
 * one `wake_sdk_register_kws_backend(sdk, &ops)` line; the core never knows a
 * backend id.
 */
#include "wake/capabilities.h"
#include "wake/kws_backend.h"

#include <string.h>

#include "internal.h"

int wake_sdk_register_kws_backend(wake_sdk_t *sdk,
                                  const wake_kws_backend_ops_t *ops) {
  if (sdk == nullptr || ops == nullptr || ops->id == nullptr) {
    return 1;
  }
  if (wake_sdk_backend_by_id(sdk, ops->id) != nullptr) {
    return 1; /* duplicate — ignore */
  }
  if (sdk->backend_count >= WAKE_SDK_MAX_BACKENDS) {
    return 1; /* registry full */
  }
  sdk->backends[sdk->backend_count] = ops;
  sdk->backend_ids[sdk->backend_count] = ops->id;
  sdk->backend_count += 1;
  return 0;
}

unsigned wake_sdk_backend_count(const wake_sdk_t *sdk) {
  return sdk->backend_count;
}

const wake_kws_backend_ops_t *wake_sdk_backend_at(const wake_sdk_t *sdk,
                                                  unsigned index) {
  if (index >= sdk->backend_count) {
    return nullptr;
  }
  return sdk->backends[index];
}

const wake_kws_backend_ops_t *wake_sdk_backend_by_id(const wake_sdk_t *sdk,
                                                     const char *id) {
  for (unsigned i = 0; i < sdk->backend_count; ++i) {
    if (sdk->backends[i]->id != nullptr && id != nullptr &&
        strcmp(sdk->backends[i]->id, id) == 0) {
      return sdk->backends[i];
    }
  }
  return nullptr;
}

wake_sdk_capabilities_t wake_sdk_capabilities(const wake_sdk_t *sdk) {
  wake_sdk_capabilities_t c;
  c.backend_count = sdk->backend_count;
  c.backend_ids = sdk->backend_ids;
#if defined(WAKE_SDK_PROFILE_APP)
  c.have_threads = 1;
  c.have_float_dsp = 1;
  c.heap_budget_kb = 0; /* unbounded */
#else /* WAKE_SDK_PROFILE_MCU */
  c.have_threads = 0;
  c.have_float_dsp = 0;
  c.heap_budget_kb = 256; /* static-buffer budget (heap for model runtime) */
#endif
  /* VAD ships with the RNNoise module (AFE milestone #181); the core assumes
   * a VAD stage is available in both profiles. */
  c.have_vad = 1;
  c.sample_rate_hz = 16000;
  return c;
}
