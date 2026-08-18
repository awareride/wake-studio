/*
 * wake/sdk.h — WakeStudio device-side SDK public entry (ADR-021 / ADR-040).
 *
 * Strict C ABI: this header is usable from C and C++ (extern "C"), so every
 * language binding (Python ctypes, Kotlin JNI, Swift, JS/WASM) can consume
 * the SDK through one interface.
 */
#ifndef WAKE_SDK_H
#define WAKE_SDK_H

#ifdef __cplusplus
extern "C" {
#endif

/* SDK version (semver-ish; bumped per release). */
#define WAKE_SDK_VERSION_MAJOR 0
#define WAKE_SDK_VERSION_MINOR 1
#define WAKE_SDK_VERSION_PATCH 0
#define WAKE_SDK_VERSION_STRING "0.1.0"

/* Opaque SDK handle. One instance per process (per pipeline). */
typedef struct wake_sdk wake_sdk_t;

/* SDK-level configuration (per-pipeline tuning comes with the KWS config,
 * see wake/kws_backend.h). */
typedef struct wake_sdk_config {
  /** Max number of frames the pipeline buffers (0 = profile default). */
  unsigned max_frame_buffer;
  /** Enable the VAD gate (off for mcu profiles without VAD). */
  int vad_gate_enabled;
} wake_sdk_config_t;

/** Create an SDK instance. Returns NULL on failure. */
wake_sdk_t *wake_sdk_create(const wake_sdk_config_t *config);

/** Destroy an SDK instance (idempotent on NULL). */
void wake_sdk_destroy(wake_sdk_t *sdk);

/** Return the compiled-in SDK version string (static, never NULL). */
const char *wake_sdk_version(void);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_SDK_H */
