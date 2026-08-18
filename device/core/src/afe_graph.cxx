/*
 * afe_graph.cxx — AFE graph orchestrator + stage registry (ADR-016).
 */
#include "wake/afe_graph.h"

#include <cstdlib>
#include <cstring>
#include <new>

#include "internal.h"

/* --- stage registry on the SDK instance ------------------------------------ */

struct wake_afe_graph;

int wake_sdk_register_afe_stage(wake_sdk_t *sdk, const wake_afe_stage_ops_t *ops) {
  if (sdk == nullptr || ops == nullptr || ops->id == nullptr) {
    return 1;
  }
  for (unsigned i = 0; i < sdk->stage_count; ++i) {
    if (sdk->stages[i]->id != nullptr &&
        std::strcmp(sdk->stages[i]->id, ops->id) == 0) {
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
        std::strcmp(sdk->stages[i]->id, id) == 0) {
      return sdk->stages[i];
    }
  }
  return nullptr;
}

/* --- per-pipeline graph ----------------------------------------------------- */

struct wake_afe_graph {
  const wake_afe_stage_ops_t *ops[WAKE_SDK_MAX_STAGES];
  void *impls[WAKE_SDK_MAX_STAGES];
  unsigned count;
};

wake_afe_graph_t *wake_afe_graph_create(void) {
  void *mem = std::calloc(1, sizeof(wake_afe_graph));
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
    g->ops[i]->destroy(g->impls[i]);
  }
  std::free(g);
}

int wake_afe_graph_append(wake_afe_graph_t *g, const wake_afe_stage_ops_t *ops) {
  if (g == nullptr || ops == nullptr || ops->create == nullptr) {
    return 1;
  }
  if (g->count >= WAKE_SDK_MAX_STAGES) {
    return 1;
  }
  void *impl = ops->create();
  if (impl == nullptr) {
    return 1;
  }
  g->ops[g->count] = ops;
  g->impls[g->count] = impl;
  g->count += 1;
  return 0;
}

int wake_afe_graph_process(wake_afe_graph_t *g, int16_t *frames, size_t n,
                           float *vad_out) {
  float vad = 0.0f;
  for (unsigned i = 0; i < g->count; ++i) {
    float stage_vad = 0.0f;
    if (g->ops[i]->process(g->impls[i], frames, n, &stage_vad) != 0) {
      return 1;
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

void wake_afe_graph_reset(wake_afe_graph_t *g) {
  for (unsigned i = 0; i < g->count; ++i) {
    g->ops[i]->reset(g->impls[i]);
  }
}
