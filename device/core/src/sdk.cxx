/*
 * sdk.cxx — wake_sdk_t lifecycle (ADR-021).
 *
 * The instance owns the registries (KWS backends + AFE stages) and the
 * pipeline config; the composition root (ADR-040 §3) registers modules into
 * it after create().
 */
#include "wake/sdk.h"

#include <cstdlib>
#include <new>

#include "internal.h"

wake_sdk_t *wake_sdk_create(const wake_sdk_config_t *config) {
  void *mem = calloc(1, sizeof(wake_sdk));
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
  free(sdk);
}

const char *wake_sdk_version(void) { return WAKE_SDK_VERSION_STRING; }
