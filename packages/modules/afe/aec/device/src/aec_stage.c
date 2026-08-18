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
static int aec_process(void *impl, int16_t *frames, size_t n, float *vad_out) {
  (void)impl; (void)frames; (void)n; (void)vad_out;
  return 0; /* passthrough */
}
static void aec_reset(void *impl) { (void)impl; }

const wake_afe_stage_ops_t wake_afe_aec_ops = {
    "aec", "AEC (passthrough v1)", aec_create, aec_destroy, aec_process,
    aec_reset};
