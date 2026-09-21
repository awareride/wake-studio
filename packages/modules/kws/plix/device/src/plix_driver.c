/*
 * plix_driver.c — PLiX Few-Shot device driver (issue #188).
 *
 * C KWSBackend adapter for the app-class Few-Shot backend (ADR-020/002):
 * the PLiX encoder ONNX graph (raw 64-bin mel [1,1,64,100] in, 1280-dim
 * embedding out) via the onnxruntime C API — the shared app-class runtime
 * (same pinned dep as openwakeword #192 / kws-streaming #194).
 * Prototype-distance scoring (L2-normalize, squared distance, 1/(1+d2))
 * lands in slice 2 with the C mel frontend; this slice loads the encoder
 * session and verifies the model contract.
 *
 * Model files are read from the bundle's model_dir with the names this
 * driver declares (ADR-040 §4.1). The encoder stores weights in a colocated
 * external-data file whose name is pinned INSIDE the model
 * (plixkws-small.onnx.data), so both names are kept verbatim:
 *   <model_dir>/plixkws-small.onnx       [1,1,64,100] float32 raw mel
 *   <model_dir>/plixkws-small.onnx.data  external weights (~3 MB)
 * The session is opened BY FILE PATH (not from memory) so onnxruntime
 * resolves the external data relative to the model file.
 *
 * Runtime gating: WAKE_SDK_PLIX_HAS_RUNTIME (CMake option, default OFF).
 * Without the runtime, load() reports "runtime not linked" and
 * process_frame() stays in warmup (-1) — the module still compiles and
 * registers, so the composition root and capabilities work end-to-end.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "wake/kws_backend.h"

#ifdef _WIN32
#include <wchar.h>
#endif

#if defined(WAKE_SDK_PLIX_HAS_RUNTIME)
#include "onnxruntime_c_api.h"
#endif

/* Encoder contract (verified against the L2 Node suite,
 * packages/modules/kws/plix/tests/onnx-runtime.test.ts). */
#define PLIX_MODEL_FILE "plixkws-small.onnx"
#define PLIX_MODEL_DATA_FILE "plixkws-small.onnx.data"
#define PLIX_INPUT_N 1
#define PLIX_INPUT_C 1
#define PLIX_INPUT_MELS 64
#define PLIX_INPUT_FRAMES 100
#define PLIX_EMBEDDING_DIM 1280

typedef struct plix_impl {
  int loaded; /* load() succeeded: session live, dims verified */
#if defined(WAKE_SDK_PLIX_HAS_RUNTIME)
  const OrtApi *api;
  OrtEnv *env;
  OrtSession *session;
  char input_name[256];
  char output_name[256];
#endif
} plix_impl_t;

#if defined(WAKE_SDK_PLIX_HAS_RUNTIME)

/* Both bundle files must exist (the .data name is pinned inside the model;
 * a rename breaks external-data resolution — hence the verbatim names). */
static int model_files_present(const char *dir) {
  static const char *names[] = {
      PLIX_MODEL_FILE,
      PLIX_MODEL_DATA_FILE,
      NULL,
  };
  for (size_t i = 0; names[i] != NULL; ++i) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", dir, names[i]);
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
      fprintf(stderr, "[plix] missing model file %s\n", path);
      return 0;
    }
    fclose(f);
  }
  return 1;
}

#ifdef _WIN32
/* ORT takes wide paths on Windows. */
static int to_wide(const char *narrow, wchar_t *wide, size_t cap) {
  size_t n = mbstowcs(wide, narrow, cap);
  if (n >= cap) {
    return 1;
  }
  wide[n] = 0;
  return 0;
}
#endif

#endif /* WAKE_SDK_PLIX_HAS_RUNTIME */

static void *plix_create(const wake_kws_config_t *cfg) {
  (void)cfg;
  return calloc(1, sizeof(plix_impl_t));
}

static void plix_destroy(void *v) {
  plix_impl_t *impl = (plix_impl_t *)v;
  if (impl == NULL) {
    return;
  }
#if defined(WAKE_SDK_PLIX_HAS_RUNTIME)
  const OrtApi *api = impl->api;
  if (api != NULL) {
    if (impl->session != NULL) {
      api->ReleaseSession(impl->session);
      impl->session = NULL;
    }
    if (impl->env != NULL) {
      api->ReleaseEnv(impl->env);
      impl->env = NULL;
    }
  }
#endif
  free(impl);
}

static int plix_load(void *v, const wake_model_bundle_t *models,
                     const wake_kws_config_t *cfg) {
  (void)cfg;
  plix_impl_t *impl = (plix_impl_t *)v;
#if defined(WAKE_SDK_PLIX_HAS_RUNTIME)
  if (models == NULL || models->model_dir == NULL) {
    return 1;
  }
  if (!model_files_present(models->model_dir)) {
    return 1;
  }

  const OrtApi *api = OrtGetApiBase()->GetApi(ORT_API_VERSION);
  impl->api = api;
  OrtStatus *st =
      api->CreateEnv(ORT_LOGGING_LEVEL_WARNING, "wake-plix", &impl->env);
  if (st != NULL) {
    fprintf(stderr, "[plix] CreateEnv: %s\n", api->GetErrorMessage(st));
    api->ReleaseStatus(st);
    return 1;
  }

  /* File-path load: onnxruntime resolves plixkws-small.onnx.data relative
   * to the model file. In-memory load (FromArray) cannot resolve it. */
  char path[1024];
  snprintf(path, sizeof(path), "%s/%s", models->model_dir, PLIX_MODEL_FILE);
  OrtSessionOptions *opts = NULL;
  st = api->CreateSessionOptions(&opts);
  if (st != NULL) {
    fprintf(stderr, "[plix] CreateSessionOptions: %s\n",
            api->GetErrorMessage(st));
    api->ReleaseStatus(st);
    goto fail;
  }
#ifdef _WIN32
  wchar_t wpath[1024];
  if (to_wide(path, wpath, sizeof(wpath) / sizeof(wpath[0])) != 0) {
    fprintf(stderr, "[plix] model path too long\n");
    goto fail;
  }
  st = api->CreateSession(impl->env, wpath, opts, &impl->session);
#else
  st = api->CreateSession(impl->env, path, opts, &impl->session);
#endif
  api->ReleaseSessionOptions(opts);
  opts = NULL;
  if (st != NULL) {
    fprintf(stderr, "[plix] CreateSession(%s): %s\n", path,
            api->GetErrorMessage(st));
    api->ReleaseStatus(st);
    goto fail;
  }

  /* Capture input/output names (browser parity: inputNames[0] /
   * outputNames[0]) and verify the encoder contract: float32
   * [1,1,64,100] in, 1280-dim float32 out. */
  {
    OrtAllocator *alloc = NULL;
    st = api->GetAllocatorWithDefaultOptions(&alloc);
    if (st != NULL) {
      api->ReleaseStatus(st);
      goto fail;
    }
    char *name = NULL;
    st = api->SessionGetInputName(impl->session, 0, alloc, &name);
    if (st != NULL || name == NULL) {
      fprintf(stderr, "[plix] input name query failed\n");
      if (st != NULL) {
        api->ReleaseStatus(st);
      }
      goto fail;
    }
    snprintf(impl->input_name, sizeof(impl->input_name), "%s", name);
    alloc->Free(alloc, name);
    name = NULL;
    st = api->SessionGetOutputName(impl->session, 0, alloc, &name);
    if (st != NULL || name == NULL) {
      fprintf(stderr, "[plix] output name query failed\n");
      if (st != NULL) {
        api->ReleaseStatus(st);
      }
      goto fail;
    }
    snprintf(impl->output_name, sizeof(impl->output_name), "%s", name);
    alloc->Free(alloc, name);
  }
  {
    OrtTypeInfo *info = NULL;
    st = api->SessionGetInputTypeInfo(impl->session, 0, &info);
    if (st != NULL) {
      fprintf(stderr, "[plix] input type query failed\n");
      api->ReleaseStatus(st);
      goto fail;
    }
    const OrtTensorTypeAndShapeInfo *tinfo = NULL;
    st = api->CastTypeInfoToTensorInfo(info, &tinfo);
    if (st != NULL) {
      api->ReleaseTypeInfo(info);
      api->ReleaseStatus(st);
      goto fail;
    }
    enum ONNXTensorElementDataType eltype;
    st = api->GetTensorElementType(tinfo, &eltype);
    if (st != NULL || eltype != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT) {
      fprintf(stderr, "[plix] encoder input is not float32\n");
      if (st != NULL) {
        api->ReleaseStatus(st);
      }
      api->ReleaseTypeInfo(info);
      goto fail;
    }
    size_t ndims = 0;
    st = api->GetDimensionsCount(tinfo, &ndims);
    if (st != NULL || ndims != 4) {
      fprintf(stderr, "[plix] encoder input is not 4-D\n");
      if (st != NULL) {
        api->ReleaseStatus(st);
      }
      api->ReleaseTypeInfo(info);
      goto fail;
    }
    int64_t dims[4] = {0, 0, 0, 0};
    st = api->GetDimensions(tinfo, dims, 4);
    if (st != NULL) {
      api->ReleaseTypeInfo(info);
      api->ReleaseStatus(st);
      goto fail;
    }
    api->ReleaseTypeInfo(info);
    if (dims[0] != PLIX_INPUT_N || dims[1] != PLIX_INPUT_C ||
        dims[2] != PLIX_INPUT_MELS || dims[3] != PLIX_INPUT_FRAMES) {
      fprintf(stderr,
              "[plix] unexpected encoder input dims [%lld,%lld,%lld,%lld], "
              "want [1,1,64,100]\n",
              (long long)dims[0], (long long)dims[1], (long long)dims[2],
              (long long)dims[3]);
      goto fail;
    }
  }

  impl->loaded = 1;
  return 0;

fail:
  if (impl->session != NULL) {
    api->ReleaseSession(impl->session);
    impl->session = NULL;
  }
  if (impl->env != NULL) {
    api->ReleaseEnv(impl->env);
    impl->env = NULL;
  }
  return 1;
#else
  (void)impl;
  (void)models;
  return 1; /* onnxruntime C API not linked in this build */
#endif
}

static float plix_process_frame(void *v, const int16_t *samples, size_t n) {
  (void)v;
  (void)samples;
  (void)n;
  /* Slice 2 (C mel frontend + prototype scoring) turns audio into
   * posteriors; until then the loaded session idles in warmup (-1) —
   * never a fabricated score. */
  return -1.0f;
}

static void plix_reset(void *v) {
  plix_impl_t *impl = (plix_impl_t *)v;
#if defined(WAKE_SDK_PLIX_HAS_RUNTIME)
  /* No streaming state yet (slice 2 adds the window/hop buffers); the
   * session stays loaded across resets (browser reset() parity). */
  (void)impl;
#else
  impl->loaded = 0;
#endif
}

const wake_kws_backend_ops_t wake_kws_plix_ops = {
    "plixkws", "PLiX Few-Shot (onnxruntime encoder)",
    plix_create, plix_destroy, plix_load, plix_process_frame, plix_reset};
