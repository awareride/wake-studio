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
 * The graph's own audio rate and frame size (issue #245).
 *
 * The browser runs its AFE chain at 48 kHz internally and downsamples to 16 kHz
 * before the KWS; the device graph still runs at 16 kHz. These constants make
 * the device rate explicit instead of implicit, and they are what a stage's
 * declared rate is validated against.
 */
#define WAKE_AFE_GRAPH_SAMPLE_RATE_HZ 16000u
#define WAKE_AFE_GRAPH_FRAME_SAMPLES 160u /* 10 ms */

/*
 * One AFE stage (module-owned).
 *
 * `sample_rate_hz` + `frame_samples` DECLARE the rate the stage's DSP runs at
 * (issue #245). The graph owns any conversion: a stage declaring the graph rate
 * is called directly, and a stage declaring another rate is fed a converted,
 * frame-sized buffer and its output is converted back. This replaces the old
 * arrangement where a stage quietly assumed a rate and converted by hand -- an
 * implicit, per-stage, untested assumption, which is how a 48 kHz model ended
 * up being fed 16 kHz audio (#240 B2).
 *
 * Declared rates must satisfy `frame_samples * graph_rate == graph_frame *
 * stage_rate`, i.e. the same frame duration at the stage's rate, with an integer
 * ratio. `wake_afe_graph_append` rejects anything else instead of guessing.
 *
 * NOTE (#245 slice B): still single-channel. There is no channel count and no
 * far-end reference input, so AEC3/BSS cannot drop in unchanged.
 */
typedef struct wake_afe_stage_ops {
  const char *id;   /* 'aec' | 'bss' | 'ns' */
  const char *label;
  void *(*create)(void);
  void (*destroy)(void *impl);
  int (*process)(void *impl, int16_t *frames, size_t n, float *vad_out);
  void (*reset)(void *impl);
  int provides_vad;     /* non-zero when `process` writes a VAD probability */
  uint32_t sample_rate_hz; /* rate the stage DSP runs at */
  uint32_t frame_samples;  /* samples per frame at that rate */
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

/**
 * Append a stage (in pipeline order). Returns 0 on success.
 *
 * Fails (returns 1) when the stage's declared rate/frame size cannot be
 * honoured: a non-integer rate ratio, or a frame duration that does not match
 * the graph's. A stage that cannot be driven correctly is rejected at
 * registration rather than silently mis-fed.
 */
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

/**
 * Whether any appended stage declares `provides_vad`. The detection loop uses
 * this to fail open: on a VAD-less graph the trigger gate must never
 * suppress publication.
 */
int wake_afe_graph_has_vad(const wake_afe_graph_t *g);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_AFE_GRAPH_H */
