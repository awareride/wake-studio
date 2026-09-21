/*
 * plix_driver.c — PLiX Few-Shot device driver (issue #188).
 *
 * C KWSBackend adapter for the app-class Few-Shot backend (ADR-020/002):
 * the PLiX encoder ONNX graph (raw 64-bin mel [1,1,64,100] in, 1280-dim
 * embedding out) via the onnxruntime C API — the shared app-class runtime
 * (same pinned dep as openwakeword #192 / kws-streaming #194) — plus the
 * browser-parity detection loop (core/backend.ts): 1.5 s ring, 80 ms hop,
 * silence gate, L2-normalized prototype-distance scoring.
 *
 * Model files are read from the bundle's model_dir with the names this
 * driver declares (ADR-040 §4.1). The encoder stores weights in a colocated
 * external-data file whose name is pinned INSIDE the model
 * (plixkws-small.onnx.data), so both names are kept verbatim:
 *   <model_dir>/plixkws-small.onnx       [1,1,64,100] float32 raw mel
 *   <model_dir>/plixkws-small.onnx.data  external weights (~3 MB)
 *   <model_dir>/plix_prototype.json      enrolled prototype (provisional
 *     sidecar until the bundle generator (#189) designs the config file;
 *     {"vector":[...1280...], "negativeVector":[...]} — see below)
 * The session is opened BY FILE PATH (not from memory) so onnxruntime
 * resolves the external data relative to the model file.
 *
 * Runtime gating: WAKE_SDK_PLIX_HAS_RUNTIME (CMake option, default OFF).
 * Without the runtime, load() reports "runtime not linked" and
 * process_frame() stays in warmup (-1) — the module still compiles and
 * registers, so the composition root and capabilities work end-to-end.
 */
#include <math.h>
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
#include "plix_frontend.h"
#endif

/* Encoder contract (verified against the L2 Node suite,
 * packages/modules/kws/plix/tests/onnx-runtime.test.ts). */
#define PLIX_MODEL_FILE "plixkws-small.onnx"
#define PLIX_MODEL_DATA_FILE "plixkws-small.onnx.data"
#define PLIX_PROTOTYPE_FILE "plix_prototype.json"
#define PLIX_INPUT_N 1
#define PLIX_INPUT_C 1
#define PLIX_INPUT_MELS 64
#define PLIX_INPUT_FRAMES 100
#define PLIX_EMBEDDING_DIM 1280

/* Detection loop (core/backend.ts parity). */
#define PLIX_WINDOW_SAMPLES 24000   /* 1.5 s ring @ 16 kHz */
#define PLIX_HOP_FRAMES 8           /* infer every 80 ms */
#define PLIX_SILENCE_FLOOR_DBFS -45.0f
/* Inference consumes the oldest 16240 samples: (16240-400)/160+1 = 100
 * frames exactly (browser fitFrames takes the head of the window mel). */
#define PLIX_INFER_SAMPLES 16240

typedef struct plix_impl {
  int loaded; /* load() succeeded: session + prototype live */
#if defined(WAKE_SDK_PLIX_HAS_RUNTIME)
  const OrtApi *api;
  OrtEnv *env;
  OrtSession *session;
  char input_name[256];
  char output_name[256];
  plix_frontend_t frontend;
  int frontend_ready;
  float ring[PLIX_WINDOW_SAMPLES];
  size_t ring_len;
  int hop_counter;
  float last_score;
  int has_score;
  float prototype[PLIX_EMBEDDING_DIM];
  float negative[PLIX_EMBEDDING_DIM];
  int has_negative;
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

/*
 * Provisional prototype sidecar (until the bundle generator (#189) designs
 * the config file): {"vector":[...1280 finite floats...],
 * "negativeVector":[...]} with "negativeVector" optional. Strict minimal
 * JSON: keys in any order, extra keys ignored, exactly PLIX_EMBEDDING_DIM
 * finite values per array. No dependency (a JSON library on device is out
 * of scope for one fixed schema).
 */
static const char *skip_ws(const char *p) {
  while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') {
    p++;
  }
  return p;
}

/* Parse one [f,f,...] array of exactly n finite floats; *pp advances past
 * ']'. Returns 0 on success. */
static int parse_float_array(const char **pp, float *out, size_t n) {
  const char *p = skip_ws(*pp);
  size_t count = 0;
  if (*p != '[') {
    return 1;
  }
  p++;
  for (;;) {
    char *end = NULL;
    double v;
    p = skip_ws(p);
    if (*p == ']') {
      p++;
      break;
    }
    if (count > 0) {
      if (*p != ',') {
        return 1;
      }
      p++;
    }
    v = strtod(p, &end);
    if (end == p || !isfinite(v)) {
      return 1;
    }
    if (count >= n) {
      return 1; /* too many */
    }
    out[count++] = (float)v;
    p = end;
  }
  if (count != n) {
    return 1; /* too few */
  }
  *pp = p;
  return 0;
}

/* Find "key" at the current object level and parse its array value.
 * Returns 1 when the key exists and parsed, 0 when absent, -1 on error. */
static int find_key_array(const char *obj, const char *key, float *out,
                          size_t n) {
  char needle[64];
  const char *hit;
  snprintf(needle, sizeof(needle), "\"%s\"", key);
  hit = strstr(obj, needle);
  if (hit == NULL) {
    return 0;
  }
  hit = skip_ws(hit + strlen(needle));
  if (*hit != ':') {
    return -1;
  }
  hit++;
  if (parse_float_array(&hit, out, n) != 0) {
    return -1;
  }
  return 1;
}

static int load_prototype(const char *dir, float *vec, float *neg,
                          int *has_neg) {
  char path[1024];
  FILE *f = NULL;
  long size = 0;
  char *text = NULL;
  int rc = 1;
  snprintf(path, sizeof(path), "%s/%s", dir, PLIX_PROTOTYPE_FILE);
  f = fopen(path, "rb");
  if (f == NULL) {
    fprintf(stderr, "[plix] missing prototype file %s\n", path);
    return 1;
  }
  if (fseek(f, 0, SEEK_END) != 0) {
    goto done;
  }
  size = ftell(f);
  if (size <= 0 || size > 4 * 1024 * 1024) {
    goto done;
  }
  rewind(f);
  text = (char *)malloc((size_t)size + 1);
  if (text == NULL) {
    goto done;
  }
  if (fread(text, 1, (size_t)size, f) != (size_t)size) {
    goto done;
  }
  text[size] = '\0';
  {
    const char *p = skip_ws(text);
    int got_vec, got_neg;
    if (*p != '{') {
      fprintf(stderr, "[plix] prototype is not a JSON object\n");
      goto done;
    }
    got_vec = find_key_array(p, "vector", vec, PLIX_EMBEDDING_DIM);
    if (got_vec != 1) {
      fprintf(stderr, "[plix] prototype needs a 1280-float \"vector\"\n");
      goto done;
    }
    got_neg = find_key_array(p, "negativeVector", neg, PLIX_EMBEDDING_DIM);
    if (got_neg < 0) {
      fprintf(stderr, "[plix] prototype \"negativeVector\" malformed\n");
      goto done;
    }
    *has_neg = (got_neg == 1);
    rc = 0;
  }
done:
  free(text);
  if (f != NULL) {
    fclose(f);
  }
  return rc;
}

/* Scoring (core/backend.ts + few-shot prototype.ts parity). */
static float plix_score_d2(const float *q, const float *p, size_t n) {
  /* 1/(1+d^2) over L2-normalized operands (#66 calibration). */
  double qn = 0.0, pn = 0.0, d2 = 0.0;
  size_t i;
  {
    double qs = 0.0, ps = 0.0;
    for (i = 0; i < n; i++) {
      qs += (double)q[i] * (double)q[i];
      ps += (double)p[i] * (double)p[i];
    }
    qn = sqrt(qs);
    pn = sqrt(ps);
  }
  if (qn < 1e-12 || pn < 1e-12) {
    return 0.0f; /* degenerate — never a trigger */
  }
  for (i = 0; i < n; i++) {
    double d = (double)q[i] / qn - (double)p[i] / pn;
    d2 += d * d;
  }
  return (float)(1.0 / (1.0 + d2));
}

static float plix_score(const float *emb, const float *proto,
                        const float *neg, int has_neg) {
  if (has_neg) {
    /* Open-set rejection (#69): 2-class softmax over squared distances,
     * P(word) = 1/(1+exp(d2-negD2)). d2 recomputed inline to share the
     * normalized query. */
    double qs = 0.0, ps = 0.0, ns = 0.0, d2 = 0.0, nd2 = 0.0;
    double qn, pn, nn;
    size_t i;
    for (i = 0; i < PLIX_EMBEDDING_DIM; i++) {
      qs += (double)emb[i] * (double)emb[i];
      ps += (double)proto[i] * (double)proto[i];
      ns += (double)neg[i] * (double)neg[i];
    }
    qn = sqrt(qs);
    pn = sqrt(ps);
    nn = sqrt(ns);
    if (qn < 1e-12 || pn < 1e-12 || nn < 1e-12) {
      return 0.0f;
    }
    for (i = 0; i < PLIX_EMBEDDING_DIM; i++) {
      double q = (double)emb[i] / qn;
      double dw = q - (double)proto[i] / pn;
      double dn = q - (double)neg[i] / nn;
      d2 += dw * dw;
      nd2 += dn * dn;
    }
    return (float)(1.0 / (1.0 + exp(d2 - nd2)));
  }
  return plix_score_d2(emb, proto, PLIX_EMBEDDING_DIM);
}

static float plix_rms_dbfs(const float *x, size_t n) {
  double sum = 0.0;
  size_t i;
  if (n == 0) {
    return -1000.0f;
  }
  for (i = 0; i < n; i++) {
    sum += (double)x[i] * (double)x[i];
  }
  sum /= (double)n;
  if (sum <= 1e-20) {
    return -1000.0f;
  }
  return (float)(10.0 * log10(sum));
}

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
  if (impl->frontend_ready) {
    plix_frontend_free(&impl->frontend);
    impl->frontend_ready = 0;
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
    /* Prefer the 'embeddings' output (browser parity: outputNames includes
     * 'embeddings' else outputNames[0]); fall back to index 0. */
    {
      size_t n_out = 0;
      size_t i;
      int picked = 0;
      char first[256];
      first[0] = '\0';
      st = api->SessionGetOutputCount(impl->session, &n_out);
      if (st != NULL || n_out == 0) {
        fprintf(stderr, "[plix] output count query failed\n");
        if (st != NULL) {
          api->ReleaseStatus(st);
        }
        goto fail;
      }
      for (i = 0; i < n_out; i++) {
        st = api->SessionGetOutputName(impl->session, i, alloc, &name);
        if (st != NULL || name == NULL) {
          fprintf(stderr, "[plix] output name query failed\n");
          if (st != NULL) {
            api->ReleaseStatus(st);
          }
          goto fail;
        }
        if (first[0] == '\0') {
          snprintf(first, sizeof(first), "%s", name);
        }
        if (strcmp(name, "embeddings") == 0) {
          snprintf(impl->output_name, sizeof(impl->output_name), "%s", name);
          picked = 1;
        }
        alloc->Free(alloc, name);
        name = NULL;
      }
      if (!picked) {
        snprintf(impl->output_name, sizeof(impl->output_name), "%s", first);
      }
    }
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

  /* Frontend tables + FFT plan (no audio state yet). */
  if (plix_frontend_init(&impl->frontend) != 0) {
    fprintf(stderr, "[plix] frontend init failed\n");
    goto fail;
  }
  impl->frontend_ready = 1;

  /* Enrolled prototype (required — Few-Shot has no default word). */
  if (load_prototype(models->model_dir, impl->prototype, impl->negative,
                     &impl->has_negative) != 0) {
    goto fail;
  }

  impl->ring_len = 0;
  impl->hop_counter = 0;
  impl->has_score = 0;
  impl->last_score = 0.0f;
  impl->loaded = 1;
  return 0;

fail:
  if (impl->frontend_ready) {
    plix_frontend_free(&impl->frontend);
    impl->frontend_ready = 0;
  }
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

#if defined(WAKE_SDK_PLIX_HAS_RUNTIME)

/* Run the encoder over one [64,100] raw-magnitude mel image (row-major
 * [mel,frame], matching the [1,1,64,100] tensor). Output: 1280 floats.
 * Returns 0 on success. */
static int plix_embed(plix_impl_t *impl, const float *mel,
                      float *emb_out) {
  const OrtApi *api = impl->api;
  OrtStatus *st = NULL;
  OrtMemoryInfo *meminfo = NULL;
  OrtValue *in_val = NULL;
  OrtValue *out_vals[1] = {NULL};
  OrtTensorTypeAndShapeInfo *shape = NULL;
  int64_t in_dims[4] = {PLIX_INPUT_N, PLIX_INPUT_C, PLIX_INPUT_MELS,
                        PLIX_INPUT_FRAMES};
  size_t in_bytes =
      (size_t)PLIX_INPUT_MELS * PLIX_INPUT_FRAMES * sizeof(float);
  const char *in_names[1] = {impl->input_name};
  const char *out_names[1] = {impl->output_name};
  size_t ndims = 0;
  int64_t out_dims[4] = {0, 0, 0, 0};
  size_t elems = 0, i;
  void *raw = NULL;

  st = api->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault,
                                &meminfo);
  if (st != NULL) goto embed_fail;
  st = api->CreateTensorWithDataAsOrtValue(
      meminfo, (void *)mel, in_bytes, in_dims, 4,
      ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &in_val);
  if (st != NULL) goto embed_fail;
  st = api->Run(impl->session, NULL, in_names,
                (const OrtValue *const *)&in_val, 1, out_names, 1, out_vals);
  if (st != NULL) goto embed_fail;
  if (out_vals[0] == NULL) goto embed_fail;

  st = api->GetTensorTypeAndShape(out_vals[0], &shape);
  if (st != NULL) goto embed_fail;
  st = api->GetDimensionsCount(shape, &ndims);
  if (st != NULL) goto embed_fail;
  if (ndims > 4) ndims = 4;
  st = api->GetDimensions(shape, out_dims, ndims);
  if (st != NULL) goto embed_fail;
  elems = 1;
  for (i = 0; i < ndims; i++) {
    elems *= (size_t)out_dims[i];
  }
  if (elems != PLIX_EMBEDDING_DIM) {
    fprintf(stderr, "[plix] unexpected embedding size %zu, want %d\n", elems,
            PLIX_EMBEDDING_DIM);
    goto embed_fail_clean;
  }
  st = api->GetTensorMutableData(out_vals[0], &raw);
  if (st != NULL) goto embed_fail;
  memcpy(emb_out, raw, elems * sizeof(float));

  api->ReleaseTensorTypeAndShapeInfo(shape);
  api->ReleaseValue(out_vals[0]);
  api->ReleaseValue(in_val);
  api->ReleaseMemoryInfo(meminfo);
  return 0;

embed_fail:
  if (st != NULL) {
    fprintf(stderr, "[plix] inference failed: %s\n",
            api->GetErrorMessage(st));
    api->ReleaseStatus(st);
  }
embed_fail_clean:
  if (shape != NULL) {
    api->ReleaseTensorTypeAndShapeInfo(shape);
  }
  if (out_vals[0] != NULL) {
    api->ReleaseValue(out_vals[0]);
  }
  if (in_val != NULL) {
    api->ReleaseValue(in_val);
  }
  if (meminfo != NULL) {
    api->ReleaseMemoryInfo(meminfo);
  }
  return 1;
}

#endif /* WAKE_SDK_PLIX_HAS_RUNTIME */

static float plix_process_frame(void *v, const int16_t *samples, size_t n) {
#if defined(WAKE_SDK_PLIX_HAS_RUNTIME)
  plix_impl_t *impl = (plix_impl_t *)v;
  size_t i;
  float mel[PLIX_INPUT_MELS * PLIX_INPUT_FRAMES];
  float emb[PLIX_EMBEDDING_DIM];

  if (!impl->loaded || samples == NULL) {
    return -1.0f; /* warmup */
  }

  /* 1. Always append (int16 -> float, evict oldest past the window). */
  if (n >= PLIX_WINDOW_SAMPLES) {
    for (i = 0; i < PLIX_WINDOW_SAMPLES; i++) {
      impl->ring[i] = (float)samples[n - PLIX_WINDOW_SAMPLES + i] *
                      (1.0f / 32768.0f);
    }
    impl->ring_len = PLIX_WINDOW_SAMPLES;
  } else {
    size_t keep = 0;
    if (impl->ring_len + n > PLIX_WINDOW_SAMPLES) {
      keep = PLIX_WINDOW_SAMPLES - n;
      memmove(impl->ring, impl->ring + (impl->ring_len - keep),
              keep * sizeof(float));
    } else {
      keep = impl->ring_len;
      if (keep > 0) {
        memmove(impl->ring, impl->ring + (impl->ring_len - keep),
                keep * sizeof(float));
      }
    }
    for (i = 0; i < n; i++) {
      impl->ring[keep + i] =
          (float)samples[i] * (1.0f / 32768.0f);
    }
    impl->ring_len = keep + n;
  }

  /* 2. Hop: infer every 8th frame; hold the last score between runs. */
  impl->hop_counter++;
  if (impl->hop_counter < PLIX_HOP_FRAMES) {
    return impl->has_score ? impl->last_score : -1.0f;
  }
  impl->hop_counter = 0;

  /* 3. Need a full window before scoring (warmup). The ring holds the
   * latest window when full — no copy needed. */
  if (impl->ring_len < PLIX_WINDOW_SAMPLES) {
    return -1.0f;
  }

  /* 4. Silence gate: a window at/below the energy floor is not the wake
   * word — score 0 without running the encoder (browser parity: the model
   * maps silence near the prototype, so gating is required). */
  if (plix_rms_dbfs(impl->ring, PLIX_WINDOW_SAMPLES) <
      PLIX_SILENCE_FLOOR_DBFS) {
    impl->last_score = 0.0f;
    impl->has_score = 1;
    return 0.0f;
  }

  /* 5. Mel over the oldest INFER samples (= first 100 frames, browser
   * fitFrames-head parity), then embed + prototype-distance score. */
  {
    float frame[PLIX_FE_WINDOW_LENGTH];
    for (i = 0; i < PLIX_INPUT_FRAMES; i++) {
      float out[PLIX_FE_N_MELS];
      size_t m, base = i * PLIX_FE_HOP_LENGTH;
      for (m = 0; m < PLIX_FE_WINDOW_LENGTH; m++) {
        frame[m] = impl->ring[base + m];
      }
      /* Stateless frame call: history untouched (reset-safe). */
      plix_frontend_frame(&impl->frontend, frame, out);
      for (m = 0; m < PLIX_INPUT_MELS; m++) {
        mel[m * PLIX_INPUT_FRAMES + i] = out[m];
      }
    }
  }
  if (plix_embed(impl, mel, emb) != 0) {
    /* Failed invoke: hold the last score (zero-order hold) rather than
     * fabricate or flap to warmup. */
    return impl->has_score ? impl->last_score : -1.0f;
  }
  impl->last_score =
      plix_score(emb, impl->prototype, impl->negative, impl->has_negative);
  impl->has_score = 1;
  if (!(impl->last_score >= 0.0f) || !(impl->last_score <= 1.0f)) {
    /* Non-finite guard (NaN can only come from a degenerate embedding). */
    impl->last_score = 0.0f;
  }
  return impl->last_score;
#else
  (void)v;
  (void)samples;
  (void)n;
  /* Slice 2 (C mel frontend + prototype scoring) turns audio into
   * posteriors; until then the loaded session idles in warmup (-1) —
   * never a fabricated score. */
  return -1.0f;
#endif
}

static void plix_reset(void *v) {
  plix_impl_t *impl = (plix_impl_t *)v;
#if defined(WAKE_SDK_PLIX_HAS_RUNTIME)
  /* Browser reset() parity: clear the ring/hop/score state; the session,
   * prototype, and frontend tables stay loaded. */
  impl->ring_len = 0;
  impl->hop_counter = 0;
  impl->has_score = 0;
  impl->last_score = 0.0f;
  memset(impl->ring, 0, sizeof(impl->ring));
  plix_frontend_reset(&impl->frontend);
#else
  impl->loaded = 0;
#endif
}

const wake_kws_backend_ops_t wake_kws_plix_ops = {
    "plixkws", "PLiX Few-Shot (onnxruntime encoder)",
    plix_create, plix_destroy, plix_load, plix_process_frame, plix_reset};
