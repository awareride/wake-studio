/*
 * sdk.cxx — wake_sdk_t lifecycle (scaffold).
 *
 * The registry (KWS backends + AFE stages), capabilities, and the detection
 * loop land in the core milestones (#180/#181); this translation unit only
 * owns the handle.
 */
#include "wake/sdk.h"

#include <cstdlib>
#include <new>

struct wake_sdk {
  wake_sdk_config_t config;
};

wake_sdk_t *wake_sdk_create(const wake_sdk_config_t *config) {
  void *mem = std::malloc(sizeof(wake_sdk));
  if (mem == nullptr) {
    return nullptr;
  }
  wake_sdk *sdk = new (mem) wake_sdk;
  sdk->config = config ? *config : wake_sdk_config_t{};
  return sdk;
}

void wake_sdk_destroy(wake_sdk_t *sdk) {
  if (sdk == nullptr) {
    return;
  }
  sdk->~wake_sdk();
  std::free(sdk);
}

const char *wake_sdk_version(void) { return WAKE_SDK_VERSION_STRING; }
