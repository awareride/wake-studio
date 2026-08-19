/*
 * internal.h — private layout of the wake_sdk_t instance.
 *
 * Shared by sdk.cxx (lifecycle), registry.cxx (backend/stage registration)
 * and capabilities.cxx (capability query). Static arrays keep the core
 * free of dynamic allocation so the mcu profile can run with static buffers
 * (ADR-040 §4).
 */
#ifndef WAKE_INTERNAL_H
#define WAKE_INTERNAL_H

#include "wake/afe_graph.h"
#include "wake/kws_backend.h"

/* Stage registry capacity (see WAKE_SDK_MAX_STAGES in afe_graph.h). */
#define WAKE_SDK_MAX_STAGES 16

struct wake_sdk {
  wake_sdk_config_t config;

  /* KWS backend registry (ADR-020). */
  const wake_kws_backend_ops_t *backends[WAKE_SDK_MAX_BACKENDS];
  const char *backend_ids[WAKE_SDK_MAX_BACKENDS]; /* ptrs into ops->id */
  unsigned backend_count;

  /* AFE stage registry (ADR-016). */
  const wake_afe_stage_ops_t *stages[WAKE_SDK_MAX_STAGES];
  unsigned stage_count;
};

#endif /* WAKE_INTERNAL_H */
