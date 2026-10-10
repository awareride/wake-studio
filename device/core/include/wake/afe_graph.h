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
/*
 * The AFE-internal rate (issue #245 slice C).
 *
 * 48 kHz, deliberately: this is what the browser already runs its chain at, and
 * it is the native rate of the components we attach (RNNoise is 48 kHz-only,
 * WebRTC AEC3/APM target 48 kHz). Keeping the device on a different internal rate
 * is what forced per-stage conversions in the first place. The KWS boundary is
 * unaffected -- drivers still receive 160 samples @ 16 kHz, because the pipeline
 * downsamples once at that boundary.
 */
#define WAKE_AFE_GRAPH_SAMPLE_RATE_HZ 48000u
#define WAKE_AFE_GRAPH_FRAME_SAMPLES 480u /* 10 ms */

/* Upper bound on mic/reference channels the graph will carry. Static storage is
 * MCU-friendly and generous for the array sizes WakeStudio targets (#245). */
#define WAKE_AFE_MAX_CHANNELS 4u

/* --- geometry (issue #245 slice B) ---------------------------------------- */

/**
 * One frame of audio handed to / produced by a stage, planar.
 *
 * A single microphone is the degenerate case (`channel_count == 1`,
 * `reference == NULL`), and it stays the default everywhere. Nothing here
 * presumes an array: a project declares its geometry and the graph validates it
 * against what each stage can accept.
 *
 * `reference` carries the far-end render signal for echo cancellation. It is
 * optional (`NULL` when `reference_count == 0`), which is why an AEC stage can
 * only be enabled on a capture that actually provides one.
 */
typedef struct wake_afe_frame {
  int16_t **channels;       /* planar mic channels */
  uint16_t channel_count;   /* 1 = single mic (the default) */
  int16_t **reference;      /* planar far-end render channels, may be NULL */
  uint16_t reference_count; /* 0 when there is no reference */
  size_t frame_samples;     /* samples per channel */
} wake_afe_frame_t;

/**
 * One AFE stage (module-owned).
 *
 * `sample_rate_hz` + `frame_samples` DECLARE the rate the stage's DSP runs at
 * (issue #245 slice A). The graph owns any conversion: a stage declaring the
 * graph rate is called directly, and a stage declaring another rate is fed a
 * converted, frame-sized buffer and its output is converted back. This replaces
 * the old arrangement where a stage quietly assumed a rate and converted by
 * hand -- an implicit, per-stage, untested assumption, which is how a 48 kHz
 * model ended up being fed 16 kHz audio (#240 B2).
 *
 * Declared rates must satisfy `frame_samples * graph_rate == graph_frame *
 * stage_rate`, i.e. the same frame duration at the stage's rate, with an integer
 * ratio. `wake_afe_graph_append` rejects anything else instead of guessing.
 *
 * `input_channels` / `output_channels` / `reference_channels` declare the
 * geometry the stage needs and produces (slice B). Single-mic stages declare
 * 1/1/0 and cost nothing extra. A stage that declares >1 input channel is
 * **spatial** and may only run on a qualified capture (#246): enabling one is the
 * caller's decision, but the graph refuses a geometry it cannot serve.
 */
typedef struct wake_afe_stage_ops {
  const char *id;   /* 'aec' | 'bss' | 'ns' */
  const char *label;
  void *(*create)(void);
  void (*destroy)(void *impl);
  int (*process)(void *impl, const wake_afe_frame_t *in, wake_afe_frame_t *out,
                 float *vad_out);
  void (*reset)(void *impl);
  int provides_vad;        /* non-zero when `process` writes a VAD probability */
  uint32_t sample_rate_hz; /* rate the stage DSP runs at */
  uint32_t frame_samples;  /* samples per frame at that rate */
  uint16_t input_channels;    /* mic channels consumed */
  uint16_t output_channels;   /* channels produced */
  uint16_t reference_channels;/* far-end channels consumed (0 = none) */
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
 * Run the chain over one frame with explicit geometry (#245 slice B).
 *
 * Validates each stage's declared geometry before calling it: a stage never sees
 * fewer mic channels than it declared, nor a missing far-end reference. The
 * output frame is written in place; pass `in` as `out` for in-place processing.
 */
int wake_afe_graph_process_frame(wake_afe_graph_t *g,
                                 const wake_afe_frame_t *in,
                                 wake_afe_frame_t *out, float *vad_out);

/**
 * Mono convenience wrapper over wake_afe_graph_process_frame().
 *
 * Single-mic is the default and the zero-cost path, so the existing callers keep
 * working unchanged.
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
