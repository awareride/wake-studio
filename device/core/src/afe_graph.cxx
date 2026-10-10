/*
 * afe_graph.cxx — AFE graph orchestrator + stage registry (ADR-016).
 */
#include "wake/afe_graph.h"

#include <stdlib.h>
#include <string.h>
#include <new>
#include <stdint.h>

#include "internal.h"
#include "wake/resample.h"

/* --- stage registry on the SDK instance ------------------------------------ */

struct wake_afe_graph;

int wake_sdk_register_afe_stage(wake_sdk_t *sdk, const wake_afe_stage_ops_t *ops) {
  if (sdk == nullptr || ops == nullptr || ops->id == nullptr) {
    return 1;
  }
  for (unsigned i = 0; i < sdk->stage_count; ++i) {
    if (sdk->stages[i]->id != nullptr &&
        strcmp(sdk->stages[i]->id, ops->id) == 0) {
      return 1; /* duplicate — ignore */
    }
  }
  if (sdk->stage_count >= WAKE_SDK_MAX_STAGES) {
    return 1;
  }
  sdk->stages[sdk->stage_count++] = ops;
  return 0;
}

unsigned wake_sdk_stage_count(const wake_sdk_t *sdk) {
  return sdk->stage_count;
}

const wake_afe_stage_ops_t *wake_sdk_stage_by_id(const wake_sdk_t *sdk,
                                                 const char *id) {
  for (unsigned i = 0; i < sdk->stage_count; ++i) {
    if (sdk->stages[i]->id != nullptr && id != nullptr &&
        strcmp(sdk->stages[i]->id, id) == 0) {
      return sdk->stages[i];
    }
  }
  return nullptr;
}

/* --- per-pipeline graph ----------------------------------------------------- */

/*
 * Per-stage runtime state. A stage whose declared rate matches the graph needs
 * no conversion and pays nothing; one that differs gets a pair of core
 * resamplers (issue #245).
 */
#define WAKE_AFE_MAX_STAGE_FRAME (WAKE_AFE_GRAPH_FRAME_SAMPLES * 8u)

struct wake_afe_stage_slot {
  const wake_afe_stage_ops_t *ops;
  void *impl;
  wake_resampler_t *up;   /* graph rate -> stage rate (NULL when not needed) */
  wake_resampler_t *down; /* stage rate -> graph rate (NULL when not needed) */
  uint32_t stage_frame;   /* samples handed to the stage per frame */
  /* Converted audio for this stage (#245 slice B), one plane per mic channel and
   * per reference channel, sized from the declared geometry at append time. A
   * single-channel stage allocates one plane, so the mono path costs exactly
   * what it did before. */
  int16_t *stage_storage;
  size_t stage_storage_samples;
  int16_t *stage_channels[WAKE_AFE_MAX_CHANNELS];
  int16_t *stage_ref[WAKE_AFE_MAX_CHANNELS];
};

struct wake_afe_graph {
  wake_afe_stage_slot slots[WAKE_SDK_MAX_STAGES];
  unsigned count;
};

wake_afe_graph_t *wake_afe_graph_create(void) {
  void *mem = calloc(1, sizeof(wake_afe_graph));
  if (mem == nullptr) {
    return nullptr;
  }
  return new (mem) wake_afe_graph;
}

void wake_afe_graph_destroy(wake_afe_graph_t *g) {
  if (g == nullptr) {
    return;
  }
  for (unsigned i = 0; i < g->count; ++i) {
    wake_resampler_destroy(g->slots[i].up);
    wake_resampler_destroy(g->slots[i].down);
    free(g->slots[i].stage_storage);
    g->slots[i].ops->destroy(g->slots[i].impl);
  }
  free(g);
}

int wake_afe_graph_append(wake_afe_graph_t *g, const wake_afe_stage_ops_t *ops) {
  if (g == nullptr || ops == nullptr || ops->create == nullptr) {
    return 1;
  }
  if (g->count >= WAKE_SDK_MAX_STAGES) {
    return 1;
  }

  /* Validate the declared rate BEFORE creating anything (#245). A stage we
   * cannot drive correctly is rejected at registration, never silently
   * mis-fed -- that failure mode is what #240 B2 was. */
  const uint32_t rate = ops->sample_rate_hz;
  const uint32_t frame = ops->frame_samples;
  if (rate == 0u || frame == 0u) {
    return 1; /* must declare its rate */
  }
  if (rate % WAKE_AFE_GRAPH_SAMPLE_RATE_HZ != 0u &&
      WAKE_AFE_GRAPH_SAMPLE_RATE_HZ % rate != 0u) {
    return 1; /* non-integer rate ratio */
  }
  /* Same frame duration at the stage's rate, exactly. */
  if ((uint64_t)frame * WAKE_AFE_GRAPH_SAMPLE_RATE_HZ !=
      (uint64_t)WAKE_AFE_GRAPH_FRAME_SAMPLES * rate) {
    return 1;
  }
  if (frame > WAKE_AFE_MAX_STAGE_FRAME) {
    return 1;
  }
  /* Geometry (#245 slice B). A stage must declare a coherent shape: at least one
   * mic channel in, at least one out, and a reference count we can actually
   * hand it. */
  if (ops->input_channels == 0u || ops->output_channels == 0u) {
    return 1;
  }
  if (ops->reference_channels > WAKE_AFE_MAX_CHANNELS) {
    return 1;
  }

  void *impl = ops->create();
  if (impl == nullptr) {
    return 1;
  }

  wake_afe_stage_slot *slot = &g->slots[g->count];
  slot->ops = ops;
  slot->impl = impl;
  slot->stage_frame = frame;
  slot->up = nullptr;
  slot->down = nullptr;
  slot->stage_storage = nullptr;
  slot->stage_storage_samples = 0;
  if (rate != WAKE_AFE_GRAPH_SAMPLE_RATE_HZ) {
    /* One plane per mic channel plus one per reference channel. */
    const size_t planes = (size_t)ops->input_channels + (size_t)ops->reference_channels;
    slot->stage_storage = static_cast<int16_t *>(
        calloc(planes * (size_t)frame, sizeof(int16_t)));
    if (slot->stage_storage == nullptr) {
      ops->destroy(impl);
      return 1;
    }
    slot->stage_storage_samples = planes * (size_t)frame;
  }
  if (rate != WAKE_AFE_GRAPH_SAMPLE_RATE_HZ) {
    slot->up = wake_resampler_create(WAKE_AFE_GRAPH_SAMPLE_RATE_HZ, rate);
    slot->down = wake_resampler_create(rate, WAKE_AFE_GRAPH_SAMPLE_RATE_HZ);
    if (slot->up == nullptr || slot->down == nullptr) {
      /* Unreachable given the checks above, but never leave a half-built slot. */
      wake_resampler_destroy(slot->up);
      wake_resampler_destroy(slot->down);
      slot->up = nullptr;
      slot->down = nullptr;
      ops->destroy(impl);
      free(slot->stage_storage);
      slot->stage_storage = nullptr;
      return 1;
    }
  }
  g->count += 1;
  return 0;
}

int wake_afe_graph_process_frame(wake_afe_graph_t *g,
                                 const wake_afe_frame_t *in,
                                 wake_afe_frame_t *out, float *vad_out) {
  if (g == nullptr || in == nullptr || out == nullptr || in->channels == nullptr ||
      in->channel_count == 0u) {
    return 1;
  }
  float vad = 0.0f;
  for (unsigned i = 0; i < g->count; ++i) {
    wake_afe_stage_slot *slot = &g->slots[i];
    const wake_afe_stage_ops_t *ops = slot->ops;

    /* Geometry check per stage (#245 slice B). Refusing here means a stage never
     * sees a frame it cannot interpret. */
    if (in->channel_count < ops->input_channels) {
      return 1;
    }
    if (ops->reference_channels > 0u) {
      if (in->reference == NULL || in->reference_count < ops->reference_channels) {
        return 1; /* no far-end reference: the stage cannot run */
      }
    }

    wake_afe_frame_t stage_in = *in;
    /* Stages process in place, so the output view must point at the SAME planes
     * as the input view -- otherwise a stage's processed audio is written to the
     * converted buffer while the graph reads back the untouched original. */
    wake_afe_frame_t stage_out = *out;

    if (slot->up != nullptr) {
      /* Convert every channel up to the stage's declared rate (#245 slice A). */
      size_t up_n = 0;
      for (uint16_t c = 0; c < in->channel_count; ++c) {
        int16_t *plane = slot->stage_storage + (size_t)c * slot->stage_frame;
        if (wake_resampler_process(slot->up, in->channels[c], in->frame_samples,
                                   plane, &up_n) != 0 ||
            up_n != (size_t)slot->stage_frame) {
          return 1;
        }
        slot->stage_channels[c] = plane;
      }
      stage_in.channels = slot->stage_channels;
      stage_in.frame_samples = slot->stage_frame;
      /* Reference is converted too, when the stage asked for one. */
      for (uint16_t c = 0; c < in->reference_count; ++c) {
        int16_t *plane =
            slot->stage_storage +
            ((size_t)ops->input_channels + (size_t)c) * slot->stage_frame;
        if (wake_resampler_process(slot->up, in->reference[c], in->frame_samples,
                                   plane, &up_n) != 0) {
          return 1;
        }
        slot->stage_ref[c] = plane;
      }
      if (in->reference != nullptr) {
        stage_in.reference = slot->stage_ref;
      }
      stage_out.channels = stage_in.channels;
      stage_out.reference = stage_in.reference;
      stage_out.frame_samples = stage_in.frame_samples;
    }

    float stage_vad = 0.0f;
    if (ops->process(slot->impl, &stage_in, &stage_out, &stage_vad) != 0) {
      return 1;
    }

    if (slot->down != nullptr) {
      /* Convert the processed channels back to the graph rate, in place. */
      size_t down_n = 0;
      for (uint16_t c = 0; c < out->channel_count; ++c) {
        if (wake_resampler_process(slot->down, stage_out.channels[c],
                                   stage_out.frame_samples, out->channels[c],
                                   &down_n) != 0 ||
            down_n != out->frame_samples) {
          return 1;
        }
      }
      if (stage_out.reference != nullptr && out->reference != nullptr) {
        for (uint16_t c = 0; c < out->reference_count; ++c) {
          if (wake_resampler_process(slot->down, stage_out.reference[c],
                                     stage_out.frame_samples, out->reference[c],
                                     &down_n) != 0) {
            return 1;
          }
        }
      }
    }

    if (stage_vad > 0.0f) {
      vad = stage_vad;
    }
  }
  if (vad_out != nullptr) {
    *vad_out = vad;
  }
  return 0;
}

/*
 * Mono convenience wrapper. Single-mic is the default everywhere (#245 slice B):
 * this is the zero-cost path, and it keeps the existing callers (demo, Python
 * binding, drivers, tests) unchanged.
 */
int wake_afe_graph_process(wake_afe_graph_t *g, int16_t *frames, size_t n,
                           float *vad_out) {
  if (g == nullptr || frames == nullptr) {
    return 1;
  }
  int16_t *channels[1] = {frames};
  wake_afe_frame_t in;
  in.channels = channels;
  in.channel_count = 1u;
  in.reference = nullptr;
  in.reference_count = 0u;
  in.frame_samples = n;
  return wake_afe_graph_process_frame(g, &in, &in, vad_out);
}

int wake_afe_graph_has_vad(const wake_afe_graph_t *g) {
  if (g == nullptr) {
    return 0;
  }
  for (unsigned i = 0; i < g->count; ++i) {
    if (g->slots[i].ops->provides_vad != 0) {
      return 1;
    }
  }
  return 0;
}

void wake_afe_graph_reset(wake_afe_graph_t *g) {
  if (g == nullptr) {
    return;
  }
  for (unsigned i = 0; i < g->count; ++i) {
    wake_resampler_reset(g->slots[i].up);
    wake_resampler_reset(g->slots[i].down);
    g->slots[i].ops->reset(g->slots[i].impl);
  }
}
