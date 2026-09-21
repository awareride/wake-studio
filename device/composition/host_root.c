/*
 * host_root.c — reference composition root (ADR-040 §3).
 *
 * The ONLY place modules are registered — one line per module. The bundle
 * generator (#189) emits a per-target root from the selected modules'
 * specs; this is the in-tree reference for the host (macOS/Linux) build.
 * Adding a module = one line here; the core is never edited (ADR-024).
 */
#include "wake/afe_graph.h"
#include "wake/kws_backend.h"
#include "wake/sdk.h"

/* module-provided ops */
extern const wake_afe_stage_ops_t wake_afe_ns_ops;
extern const wake_afe_stage_ops_t wake_afe_aec_ops;
extern const wake_afe_stage_ops_t wake_afe_bss_ops;
extern const wake_kws_backend_ops_t wake_kws_rms_ops; /* host adapter */
extern const wake_kws_backend_ops_t wake_kws_plix_ops; /* kws/plix (#188) */
extern const wake_kws_backend_ops_t wake_kws_openwakeword_ops; /* kws/openwakeword (#192) */
extern const wake_kws_backend_ops_t wake_kws_streaming_ops; /* kws/streaming (#194) */
extern const wake_kws_backend_ops_t wake_kws_sherpa_ops; /* kws/sherpa (#193) */

void wake_sdk_compose(wake_sdk_t *sdk) {
  wake_sdk_register_afe_stage(sdk, &wake_afe_aec_ops); /* afe/aec  */
  wake_sdk_register_afe_stage(sdk, &wake_afe_bss_ops); /* afe/bss  */
  wake_sdk_register_afe_stage(sdk, &wake_afe_ns_ops);  /* afe/rnnoise */
  wake_sdk_register_kws_backend(sdk, &wake_kws_rms_ops); /* adapters/host */
#ifdef WAKE_SDK_PROFILE_APP
  /* App-class drivers (onnxruntime family, #187 slice A). Runtime-gated:
   * without their -DHAS_RUNTIME=ON builds they register but load() fails
   * loudly, so the host build needs no third_party fetches. MCU-profile
   * builds stay single-backend (rms) per ADR-040 §4. */
  wake_sdk_register_kws_backend(sdk, &wake_kws_plix_ops); /* kws/plix */
  wake_sdk_register_kws_backend(sdk, &wake_kws_openwakeword_ops); /* kws/openwakeword */
  wake_sdk_register_kws_backend(sdk, &wake_kws_streaming_ops); /* kws/streaming */
  wake_sdk_register_kws_backend(sdk, &wake_kws_sherpa_ops); /* kws/sherpa */
#endif
}
