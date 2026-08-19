/*
 * bss_stage.c — BSS passthrough stage (v1, ADR-016).
 *
 * BSS is passthrough (or a 2-mic approximation) for v1; the stage exists so
 * the pipeline order AEC → BSS → NS holds (ADR-001) and a vendor BSS can
 * drop into this slot later without touching the graph.
 */
#include <stdint.h>
#include <stddef.h>

#include "wake/afe_graph.h"

static void *bss_create(void) { return (void *)1; }
static void bss_destroy(void *impl) { (void)impl; }
static int bss_process(void *impl, int16_t *frames, size_t n, float *vad_out) {
  (void)impl; (void)frames; (void)n; (void)vad_out;
  return 0; /* passthrough */
}
static void bss_reset(void *impl) { (void)impl; }

const wake_afe_stage_ops_t wake_afe_bss_ops = {
    "bss", "BSS (passthrough v1)", bss_create, bss_destroy, bss_process,
    bss_reset};
