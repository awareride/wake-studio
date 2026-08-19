/*
 * wake/capabilities.h — runtime capability query (ADR-040 §4.3).
 *
 * Reports what THIS build can actually do: registered backends, profile
 * features (threads / float DSP / VAD), memory budget, sample rate. This is
 * the device twin of the browser registry's `browserFeasible` (ADR-020): the
 * bundle generator uses it to pick what to ship, demos use it to show what
 * works on the build.
 */
#ifndef WAKE_CAPABILITIES_H
#define WAKE_CAPABILITIES_H

#include <stddef.h>

#include "wake/sdk.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct wake_sdk_capabilities {
  unsigned backend_count;
  /** Pointers to the registered backend ids (valid for the SDK's lifetime). */
  const char *const *backend_ids;
  int have_vad;         /* a VAD stage is compiled in */
  int have_threads;     /* app profile */
  int have_float_dsp;   /* app profile (mcu uses int16 DSP) */
  unsigned heap_budget_kb; /* 0 = unbounded (app); mcu profile budgets */
  unsigned sample_rate_hz; /* the KWS boundary rate (always 16000) */
} wake_sdk_capabilities_t;

/** Query the capabilities of a built SDK instance. */
wake_sdk_capabilities_t wake_sdk_capabilities(const wake_sdk_t *sdk);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_CAPABILITIES_H */
