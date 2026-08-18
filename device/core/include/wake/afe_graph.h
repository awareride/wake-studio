/*
 * wake/afe_graph.h — portable AFE graph + stage interface (ADR-003/016).
 *
 * The graph is the CORE-owned orchestrator (like the detection loop); stages
 * are modules (AEC → BSS → NS → [VAD]). Strict pipeline order is the
 * composition root's contract (ADR-001): aec, then bss, then ns.
 */
#ifndef WAKE_AFE_GRAPH_H
#define WAKE_AFE_GRAPH_H

#include <stddef.h>
#include <stdint.h>

#include "wake/sdk.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Max stages a single graph can hold (static storage, MCU-friendly). */
#define WAKE_SDK_MAX_STAGES 16

/*
 * One AFE stage (module-owned). A stage processes one 10 ms frame
 * (160 samples @ 16 kHz) in place. `vad_out` may be NULL; a stage that
 * carries VAD (e.g. the RNNoise NS stage) writes its probability [0,1]
 * there — the graph keeps the last non-NULL value for the detection loop.
 */
typedef struct wake_afe_stage_ops {
  const char *id;   /* 'aec' | 'bss' | 'ns' */
  const char *label;
  void *(*create)(void);
  void (*destroy)(void *impl);
  int (*process)(void *impl, int16_t *frames, size_t n, float *vad_out);
  void (*reset)(void *impl);
} wake_afe_stage_ops_t;

/* --- stage registry (composition root registers what the build ships) ------ */

/** Register a stage into the SDK instance. Returns 0 on success. */
int wake_sdk_register_afe_stage(wake_sdk_t *sdk, const wake_afe_stage_ops_t *ops);

/** Number of registered stages. */
unsigned wake_sdk_stage_count(const wake_sdk_t *sdk);

/** Stage by id, or NULL. */
const wake_afe_stage_ops_t *wake_sdk_stage_by_id(const wake_sdk_t *sdk,
                                                 const char *id);

/* --- per-pipeline graph ----------------------------------------------------- */

typedef struct wake_afe_graph wake_afe_graph_t;

/** Create an empty graph. */
wake_afe_graph_t *wake_afe_graph_create(void);
void wake_afe_graph_destroy(wake_afe_graph_t *g);

/** Append a stage (in pipeline order). Returns 0 on success. */
int wake_afe_graph_append(wake_afe_graph_t *g, const wake_afe_stage_ops_t *ops);

/**
 * Run the chain over one 10 ms frame (160 samples @ 16 kHz) in place.
 * `vad_out` receives the chain's VAD probability (0 when no stage provides
 * it). Returns 0 on success.
 */
int wake_afe_graph_process(wake_afe_graph_t *g, int16_t *frames, size_t n,
                           float *vad_out);

/** Reset every stage (e.g. on stop). */
void wake_afe_graph_reset(wake_afe_graph_t *g);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_AFE_GRAPH_H */
