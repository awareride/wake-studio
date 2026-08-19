/*
 * wake/kws_backend.h — pluggable KWS backend C interface (ADR-020, ported to
 * C per ADR-040). Mirrors the browser `KWSBackend` one-to-one so the demo and
 * the exports stay consistent (ADR-021).
 *
 * The generic detection loop (smoothing, threshold, min-duration, cooldown)
 * lives in the CORE (wake/detection.h), never in a module — the same split as
 * the browser engine (ADR-018).
 */
#ifndef WAKE_KWS_BACKEND_H
#define WAKE_KWS_BACKEND_H

#include <stddef.h>
#include <stdint.h>

#include "wake/sdk.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Max backends a single SDK instance can register (static registry; the core
 * avoids dynamic allocation so the mcu profile can run with static buffers). */
#define WAKE_SDK_MAX_BACKENDS 16

/*
 * Device-side KWS configuration. Defaults mirror the browser engine
 * (packages/modules/kws/engine/core/defaults.ts, ADR-018).
 */
typedef struct wake_kws_config {
  float threshold;                /* smoothed score must be >= this   (0.5) */
  unsigned min_duration_ms;       /* sustained above threshold (ms)    (300) */
  unsigned smoothing_window_frames; /* sliding max-pool window size    (5) */
  int vad_gate_enabled;           /* gate inference on VAD             (1) */
  float vad_threshold;            /* gate when vadProbability < this   (0.3) */
  unsigned cooldown_ms;           /* min gap between triggers (ms)    (2000) */
} wake_kws_config_t;

#define WAKE_KWS_CONFIG_DEFAULT \
  { 0.5f, 300u, 5u, 1, 0.3f, 2000u }

/* Opaque backend instance (created by the driver's create op). */
typedef struct wake_kws_backend wake_kws_backend_t;

/*
 * Model bundle location handed to load(). On device, models are FILES in a
 * bundle directory (the driver reads the names it declared) — unlike the
 * browser's URL bag (BackendModelUrls). The bundle generator (#189) emits the
 * model files + this config.
 */
typedef struct wake_model_bundle {
  const char *model_dir; /* directory holding this backend's model files */
} wake_model_bundle_t;

/*
 * Backend ops — one registration per backend (ADR-020/024). A backend
 * instance is created per pipeline; process_frame consumes one AFE frame
 * (160 samples / 10 ms @ 16 kHz) and returns the raw posterior in [0,1], or
 * -1 during warmup (not enough audio accumulated).
 */
typedef struct wake_kws_backend_ops {
  const char *id;                 /* 'microwakeword' | 'plixkws' | ... */
  const char *label;
  void *(*create)(const wake_kws_config_t *cfg);
  void (*destroy)(void *impl);
  int (*load)(void *impl, const wake_model_bundle_t *models,
              const wake_kws_config_t *cfg); /* 0 on success */
  float (*process_frame)(void *impl, const int16_t *samples, size_t n);
  void (*reset)(void *impl);
} wake_kws_backend_ops_t;

/* --- registry (called by the composition root, one line per module) ------- */

/** Register a backend into the SDK instance. Returns 0 on success; 1 if the
 *  registry is full or the id is already registered (duplicates ignored). */
int wake_sdk_register_kws_backend(wake_sdk_t *sdk,
                                  const wake_kws_backend_ops_t *ops);

/** Number of registered backends. */
unsigned wake_sdk_backend_count(const wake_sdk_t *sdk);

/** Backend at index, or NULL if out of range. */
const wake_kws_backend_ops_t *wake_sdk_backend_at(const wake_sdk_t *sdk,
                                                  unsigned index);

/** Backend by id, or NULL. */
const wake_kws_backend_ops_t *wake_sdk_backend_by_id(const wake_sdk_t *sdk,
                                                     const char *id);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_KWS_BACKEND_H */
