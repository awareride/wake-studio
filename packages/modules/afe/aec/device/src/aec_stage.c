/*
 * aec_stage.c — AEC passthrough stage (v1, ADR-016).
 *
 * AEC is passthrough for v1 in the browser and on device; the stage exists so
 * the pipeline order AEC → BSS → NS holds (ADR-001) and a vendor AEC
 * (WebRTC audio_processing / SpeexDSP) can drop into this slot later without
 * touching the graph.
 */
#include <stdint.h>
#include <stddef.h>

#include "wake/afe_graph.h"

static void *aec_create(void) { return (void *)1; }
static void aec_destroy(void *impl) { (void)impl; }
/*
 * Passthrough. Mono in, mono out (#245 slice B): the stage is declared 1/1/0, so
 * a multi-channel frame simply passes its first channel through and the graph
 * still produces mono for the KWS. A real spatial implementation will consume
 * every declared channel and declare 2/1/0.
 */
static int aec_process(void *impl, const wake_afe_frame_t *in,
                          wake_afe_frame_t *out, float *vad_out) {
  (void)impl;
  (void)in;
  (void)out;
  (void)vad_out;
  return 0; /* passthrough */
}
static void aec_reset(void *impl) { (void)impl; }

const wake_afe_stage_ops_t wake_afe_aec_ops = {
    "aec", "AEC (passthrough v1)", aec_create, aec_destroy, aec_process,
    aec_reset, 0 /* provides_vad */,
    /* Declared rate = the graph's own (#245 slice A): no conversion, no cost. */
    WAKE_AFE_GRAPH_SAMPLE_RATE_HZ, WAKE_AFE_GRAPH_FRAME_SAMPLES,
    /* Declared geometry (#245 slice B): mono, no far-end reference. */
    1, 1, 0};
