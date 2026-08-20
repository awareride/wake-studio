/*
 * openwakeword_driver.c — openWakeWord device driver (issue #192).
 *
 * C KWSBackend adapter for the app-class backend (ADR-020): the
 * melspectrogram -> speech_embedding -> classifier pipeline (ADR-024
 * Traditional category), identical to the browser driver
 * (packages/modules/kws/openwakeword/core/backend.ts). The three onnx models
 * run through the onnxruntime C API (shared app-class runtime; kws-streaming
 * #194 reuses the same dependency).
 *
 * Model files are read from the bundle's model_dir with the names this
 * driver declares (ADR-040 §4.1: the driver reads the names it declared):
 *   <model_dir>/melspectrogram.onnx   [1, samples]   -> [1, 1, time, 32]
 *   <model_dir>/embedding_model.onnx  [1,76,32,1]    -> [1, 1, 1, 96]
 *   <model_dir>/classifier.onnx       [1,16,96]      -> [1, 1] (sigmoid'd)
 *
 * Streaming (browser parity, backend.ts): each 1280-sample chunk (80 ms) plus
 * the 480-sample overlap (openWakeWord's 160*3) feeds the mel model (~8-9
 * mel frames per chunk); mel frames accumulate in a sliding buffer; the last
 * 76 frames produce one 96-dim embedding per chunk; 16 embeddings fill the
 * classifier's receptive field (~1.3 s), after which one score per chunk.
 * process_frame() consumes 160-sample AFE frames (10 ms @ 16 kHz) and
 * returns the raw posterior [0,1], or -1 during warmup.
 *
 * Runtime gating: WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME (CMake option, default
 * OFF). Without the runtime, load() reports "runtime not linked" and
 * process_frame() stays in warmup (-1) — the module still compiles and
 * registers, so the composition root and capabilities work end-to-end.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "wake/kws_backend.h"

#if defined(WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME)
#include "onnxruntime_c_api.h"
#endif

/* openWakeWord streaming constants (backend.ts, verified against utils.py). */
#define MEL_WINDOW_SIZE 1280  /* samples per chunk (80 ms @ 16 kHz) */
#define MEL_OVERLAP 480       /* samples carried between chunks (160*3) */
#define MEL_CHUNK_INPUT (MEL_WINDOW_SIZE + MEL_OVERLAP) /* 1760 */
#define MEL_MAX_FRAMES 100    /* sliding mel-frame buffer (~1 s at 100 Hz) */
#define MEL_BINS 32           /* melspectrogram output bins */
#define EMBEDDING_WINDOW 76   /* mel frames the embedding model consumes */
#define EMBEDDING_DIM 96      /* speech_embedding output dim */
#define CLASSIFIER_STEPS 16   /* classifier receptive field */
#define AUDIO_RING_CAP 2048   /* rolling audio buffer (>= 1760 + margin) */

#if defined(WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME)
typedef struct ort_session {
  OrtSession *session;
  char input_name[64];
  char output_name[64];
} ort_session_t;
#endif

typedef struct openwakeword_impl {
  int loaded; /* load() succeeded and streaming state is live */
#if defined(WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME)
  const OrtApi *api;
  OrtEnv *env;
  ort_session_t mel;
  ort_session_t embed;
  ort_session_t cls;

  /* Rolling audio buffer (float; int16 in, ONNX graph expects int16 range —
   * the browser scales float [-1,1] by 32768; device samples are int16
   * already, so the values pass through unchanged). */
  float audio_ring[AUDIO_RING_CAP];
  size_t audio_len;
  size_t new_samples; /* samples not yet consumed by a 1280-chunk */

  /* Sliding mel-frame buffer: MEL_MAX_FRAMES rows of MEL_BINS. */
  float mel_frames[MEL_MAX_FRAMES * MEL_BINS];
  size_t mel_count;

  /* Embedding ring buffer: CLASSIFIER_STEPS rows of EMBEDDING_DIM. */
  float embed_ring[CLASSIFIER_STEPS * EMBEDDING_DIM];
  size_t embed_index;
  int embed_filled;

  /* Scratch buffers (one chunk's worth, no per-frame allocation). */
  float mel_input[MEL_CHUNK_INPUT];
  float embed_input[EMBEDDING_WINDOW * MEL_BINS];
  float classifier_input[CLASSIFIER_STEPS * EMBEDDING_DIM];
#endif
} openwakeword_impl_t;

#if defined(WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME)

/* Read a whole model file into memory (models are ~0.1-2 MB). */
static int read_file(const char *path, void **out_data, size_t *out_size) {
  FILE *f = fopen(path, "rb");
  if (f == NULL) {
    return 1;
  }
  if (fseek(f, 0, SEEK_END) != 0) {
    fclose(f);
    return 1;
  }
  long size = ftell(f);
  if (size <= 0) {
    fclose(f);
    return 1;
  }
  rewind(f);
  void *data = malloc((size_t)size);
  if (data == NULL) {
    fclose(f);
    return 1;
  }
  if (fread(data, 1, (size_t)size, f) != (size_t)size) {
    free(data);
    fclose(f);
    return 1;
  }
  fclose(f);
  *out_data = data;
  *out_size = (size_t)size;
  return 0;
}

/* Create one ORT session from a model file; capture input/output names. */
static int load_session(openwakeword_impl_t *impl, const char *path,
                        ort_session_t *sess) {
  const OrtApi *api = impl->api;
  OrtStatus *st = NULL;
  OrtSessionOptions *opts = NULL;

  void *data = NULL;
  size_t size = 0;
  if (read_file(path, &data, &size) != 0) {
    fprintf(stderr, "[openwakeword] cannot read model %s\n", path);
    return 1;
  }

  st = api->CreateSessionOptions(&opts);
  if (st == NULL) {
    st = api->SetSessionGraphOptimizationLevel(opts, ORT_ENABLE_ALL);
  }
  if (st == NULL) {
    st = api->CreateSessionFromArray(impl->env, data, size, opts,
                                     &sess->session);
  }
  if (opts != NULL) {
    api->ReleaseSessionOptions(opts);
  }
  free(data);
  if (st != NULL) {
    fprintf(stderr, "[openwakeword] CreateSessionFromArray(%s): %s\n", path,
            api->GetErrorMessage(st));
    api->ReleaseStatus(st);
    return 1;
  }

  /* Input/output names are model-owned; the driver reads them (the browser
   * uses inputNames[0]/outputNames[0] — same contract). */
  OrtAllocator *alloc = NULL;
  st = api->GetAllocatorWithDefaultOptions(&alloc);
  if (st != NULL) {
    api->ReleaseStatus(st);
    return 1;
  }
  char *name = NULL;
  st = api->SessionGetInputName(sess->session, 0, alloc, &name);
  if (st == NULL && name != NULL) {
    snprintf(sess->input_name, sizeof(sess->input_name), "%s", name);
  } else {
    fprintf(stderr, "[openwakeword] input name query on %s failed\n", path);
    if (st != NULL) {
      api->ReleaseStatus(st);
    }
    if (name != NULL) {
      alloc->Free(alloc, name);
    }
    return 1;
  }
  alloc->Free(alloc, name);
  name = NULL;

  st = api->SessionGetOutputName(sess->session, 0, alloc, &name);
  if (st == NULL && name != NULL) {
    snprintf(sess->output_name, sizeof(sess->output_name), "%s", name);
  } else {
    fprintf(stderr, "[openwakeword] output name query on %s failed\n", path);
    if (st != NULL) {
      api->ReleaseStatus(st);
    }
    if (name != NULL) {
      alloc->Free(alloc, name);
    }
    return 1;
  }
  alloc->Free(alloc, name);
  return 0;
}

static void release_session(const OrtApi *api, ort_session_t *sess) {
  if (sess->session != NULL) {
    api->ReleaseSession(sess->session);
    sess->session = NULL;
  }
}

/* Run a one-input/one-output float32 session. Copies the output tensor into
 * `output` (its byte count is written to *out_bytes); `out_dims` receives the
 * output shape (up to out_dims_cap entries). Returns 0 on success. */
static int run_float32(openwakeword_impl_t *impl, ort_session_t *sess,
                       const float *input, const int64_t *input_dims,
                       size_t input_ndims, float *output, size_t *out_bytes,
                       int64_t *out_dims, size_t out_dims_cap) {
  const OrtApi *api = impl->api;
  OrtStatus *st = NULL;
  const char *errmsg = NULL;
  OrtMemoryInfo *meminfo = NULL;
  OrtValue *in_val = NULL;
  OrtValue *out_vals[1] = {NULL};
  OrtTensorTypeAndShapeInfo *shape = NULL;

  size_t in_bytes = sizeof(float);
  for (size_t i = 0; i < input_ndims; ++i) {
    in_bytes *= (size_t)input_dims[i];
  }

  st = api->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &meminfo);
  if (st != NULL) goto fail;
  st = api->CreateTensorWithDataAsOrtValue(
      meminfo, (void *)input, in_bytes, input_dims, input_ndims,
      ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &in_val);
  if (st != NULL) goto fail;

  const char *input_names[1] = {sess->input_name};
  const char *output_names[1] = {sess->output_name};
  st = api->Run(sess->session, NULL, input_names, (const OrtValue *const *)&in_val,
                1, output_names, 1, out_vals);
  if (st != NULL) goto fail;
  if (out_vals[0] == NULL) {
    errmsg = "unexpected output count";
    goto fail_clean;
  }

  /* Copy the output tensor out of the session-owned value. */
  size_t ndims = 0;
  st = api->GetTensorTypeAndShape(out_vals[0], &shape);
  if (st != NULL) goto fail;
  st = api->GetDimensionsCount(shape, &ndims);
  if (st != NULL) goto fail;
  if (ndims > out_dims_cap) ndims = out_dims_cap;
  st = api->GetDimensions(shape, out_dims, ndims);
  if (st != NULL) goto fail;

  size_t elems = 1;
  for (size_t i = 0; i < ndims; ++i) {
    elems *= (size_t)out_dims[i];
  }
  void *raw = NULL;
  st = api->GetTensorMutableData(out_vals[0], &raw);
  if (st != NULL) goto fail;
  memcpy(output, raw, elems * sizeof(float));
  *out_bytes = elems * sizeof(float);

  api->ReleaseTensorTypeAndShapeInfo(shape);
  api->ReleaseValue(out_vals[0]);
  api->ReleaseValue(in_val);
  api->ReleaseMemoryInfo(meminfo);
  return 0;

fail:
  errmsg = api->GetErrorMessage(st);
fail_clean:
  fprintf(stderr, "[openwakeword] inference on '%s' failed: %s\n",
          sess->input_name, errmsg != NULL ? errmsg : "unknown error");
  if (st != NULL) {
    api->ReleaseStatus(st);
  }
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

/* Feed the audio ring into mel -> embedding -> classifier; returns a score
 * [0,1] or -1 while warming up (browser _processChunk, backend.ts). */
static float process_chunk(openwakeword_impl_t *impl) {
  /* Take the last min(audio_len, 1760) samples: the 1280-window plus the
   * 480-sample overlap between consecutive chunks. */
  size_t input_len = impl->audio_len < MEL_CHUNK_INPUT ? impl->audio_len
                                                       : MEL_CHUNK_INPUT;
  const float *mel_audio = impl->audio_ring + (impl->audio_len - input_len);

  /* Step 1: melspectrogram [1, input_len] -> [1, 1, time, 32]. */
  int64_t mel_dims_in[2] = {1, (int64_t)input_len};
  float mel_out[MEL_MAX_FRAMES * MEL_BINS];
  size_t mel_bytes = 0;
  int64_t mel_dims[4] = {0, 0, 0, 0};
  if (run_float32(impl, &impl->mel, mel_audio, mel_dims_in, 2, mel_out,
                  &mel_bytes, mel_dims, 4) != 0) {
    return -1.0f;
  }
  const int64_t mel_time = mel_dims[2];
  const int64_t mel_bins = mel_dims[3];
  if (mel_bins != MEL_BINS) {
    /* Model mismatch; stay in warmup rather than fabricate scores. */
    return -1.0f;
  }

  /* openWakeWord melspec_transform: x/10 + 2 (utils.py). Push frames into the
   * sliding window, trimming the oldest when it exceeds MEL_MAX_FRAMES. */
  for (int64_t t = 0; t < mel_time; ++t) {
    if (impl->mel_count == MEL_MAX_FRAMES) {
      memmove(impl->mel_frames, impl->mel_frames + MEL_BINS,
              (MEL_MAX_FRAMES - 1) * MEL_BINS * sizeof(float));
      impl->mel_count = MEL_MAX_FRAMES - 1;
    }
    float *dst = impl->mel_frames + impl->mel_count * MEL_BINS;
    const float *src = mel_out + (size_t)t * MEL_BINS;
    for (int64_t b = 0; b < mel_bins; ++b) {
      dst[(size_t)b] = src[(size_t)b] / 10.0f + 2.0f;
    }
    impl->mel_count += 1;
  }

  /* Not enough mel frames for one embedding window yet (warmup). */
  if (impl->mel_count < EMBEDDING_WINDOW) {
    return -1.0f;
  }

  /* Step 2: speech_embedding [1, 76, 32, 1] -> [1, 1, 1, 96]. */
  size_t start = impl->mel_count - EMBEDDING_WINDOW;
  memcpy(impl->embed_input, impl->mel_frames + start * MEL_BINS,
         EMBEDDING_WINDOW * MEL_BINS * sizeof(float));
  int64_t embed_dims_in[4] = {1, EMBEDDING_WINDOW, MEL_BINS, 1};
  float embed_out[EMBEDDING_DIM];
  size_t embed_bytes = 0;
  int64_t embed_dims[4] = {0, 0, 0, 0};
  if (run_float32(impl, &impl->embed, impl->embed_input, embed_dims_in, 4,
                  embed_out, &embed_bytes, embed_dims, 4) != 0) {
    return -1.0f;
  }
  if (embed_bytes < EMBEDDING_DIM * sizeof(float)) {
    return -1.0f;
  }

  memcpy(impl->embed_ring + impl->embed_index * EMBEDDING_DIM, embed_out,
         EMBEDDING_DIM * sizeof(float));
  impl->embed_index = (impl->embed_index + 1) % CLASSIFIER_STEPS;
  if (impl->embed_index == 0) {
    impl->embed_filled = 1;
  }

  /* Not enough embeddings for the classifier yet (warmup). */
  if (!impl->embed_filled) {
    return -1.0f;
  }

  /* Step 3: classifier — unroll the ring oldest -> newest [1, 16, 96]. */
  for (size_t i = 0; i < CLASSIFIER_STEPS; ++i) {
    size_t src = ((impl->embed_index + i) % CLASSIFIER_STEPS) * EMBEDDING_DIM;
    memcpy(impl->classifier_input + i * EMBEDDING_DIM,
           impl->embed_ring + src, EMBEDDING_DIM * sizeof(float));
  }
  int64_t cls_dims_in[3] = {1, CLASSIFIER_STEPS, EMBEDDING_DIM};
  float cls_out[1];
  size_t cls_bytes = 0;
  int64_t cls_dims[2] = {0, 0};
  if (run_float32(impl, &impl->cls, impl->classifier_input, cls_dims_in, 3,
                  cls_out, &cls_bytes, cls_dims, 2) != 0) {
    return -1.0f;
  }
  if (cls_bytes != sizeof(float)) {
    return -1.0f;
  }

  /* The classifier's output node is Sigmoid (verified in the ONNX graph), so
   * the value is already a probability; clamp for floating-point safety. */
  float score = cls_out[0];
  if (score < 0.0f) score = 0.0f;
  if (score > 1.0f) score = 1.0f;
  return score;
}

#endif /* WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME */

static void *openwakeword_create(const wake_kws_config_t *cfg) {
  (void)cfg;
  return calloc(1, sizeof(openwakeword_impl_t));
}

static void openwakeword_destroy(void *v) {
  openwakeword_impl_t *impl = (openwakeword_impl_t *)v;
  if (impl == NULL) {
    return;
  }
#if defined(WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME)
  const OrtApi *api = impl->api;
  if (api != NULL) {
    release_session(api, &impl->cls);
    release_session(api, &impl->embed);
    release_session(api, &impl->mel);
    if (impl->env != NULL) {
      api->ReleaseEnv(impl->env);
      impl->env = NULL;
    }
  }
#endif
  free(impl);
}

static int openwakeword_load(void *v, const wake_model_bundle_t *models,
                             const wake_kws_config_t *cfg) {
  (void)cfg;
  openwakeword_impl_t *impl = (openwakeword_impl_t *)v;
#if defined(WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME)
  if (models == NULL || models->model_dir == NULL) {
    return 1;
  }

  /* Create the ORT environment + sessions. The driver reads the model names
   * it declared from the bundle dir (ADR-040 §4.1). */
  const OrtApi *api = OrtGetApiBase()->GetApi(ORT_API_VERSION);
  impl->api = api;
  OrtStatus *st = api->CreateEnv(ORT_LOGGING_LEVEL_WARNING, "wake-openwakeword",
                                 &impl->env);
  if (st != NULL) {
    fprintf(stderr, "[openwakeword] CreateEnv: %s\n", api->GetErrorMessage(st));
    api->ReleaseStatus(st);
    return 1;
  }

  char path[1024];
  snprintf(path, sizeof(path), "%s/melspectrogram.onnx", models->model_dir);
  if (load_session(impl, path, &impl->mel) != 0) {
    goto fail;
  }
  snprintf(path, sizeof(path), "%s/embedding_model.onnx", models->model_dir);
  if (load_session(impl, path, &impl->embed) != 0) {
    goto fail;
  }
  snprintf(path, sizeof(path), "%s/classifier.onnx", models->model_dir);
  if (load_session(impl, path, &impl->cls) != 0) {
    goto fail;
  }

  impl->loaded = 1;
  return 0;

fail:
  release_session(api, &impl->cls);
  release_session(api, &impl->embed);
  release_session(api, &impl->mel);
  api->ReleaseEnv(impl->env);
  impl->env = NULL;
  return 1;
#else
  (void)impl;
  (void)models;
  return 1; /* onnxruntime C API not linked in this build */
#endif
}

static float openwakeword_process_frame(void *v, const int16_t *samples,
                                        size_t n) {
  openwakeword_impl_t *impl = (openwakeword_impl_t *)v;
#if defined(WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME)
  if (!impl->loaded || samples == NULL) {
    return -1.0f; /* warmup */
  }

  /* Append to the rolling audio buffer, evicting the oldest samples when the
   * ring fills (browser _pushAudio parity: keep the most recent context). */
  if (impl->audio_len + n > AUDIO_RING_CAP) {
    size_t keep = AUDIO_RING_CAP - n;
    if (keep > 0) {
      memmove(impl->audio_ring, impl->audio_ring + (impl->audio_len - keep),
              keep * sizeof(float));
    }
    impl->audio_len = keep;
  }
  for (size_t i = 0; i < n; ++i) {
    impl->audio_ring[impl->audio_len + i] = (float)samples[i];
  }
  impl->audio_len += n;
  impl->new_samples += n;

  /* Consume 1280-sample chunks; keep the last score produced in this frame. */
  float score = -1.0f;
  while (impl->new_samples >= MEL_WINDOW_SIZE) {
    impl->new_samples -= MEL_WINDOW_SIZE;
    float s = process_chunk(impl);
    if (s >= 0.0f) {
      score = s;
    }
  }
  return score;
#else
  (void)impl;
  (void)samples;
  (void)n;
  return -1.0f; /* warmup — onnxruntime not linked */
#endif
}

static void openwakeword_reset(void *v) {
  openwakeword_impl_t *impl = (openwakeword_impl_t *)v;
#if defined(WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME)
  /* Clear the streaming state; models stay loaded (browser reset parity). */
  impl->audio_len = 0;
  impl->new_samples = 0;
  impl->mel_count = 0;
  impl->embed_index = 0;
  impl->embed_filled = 0;
  memset(impl->audio_ring, 0, sizeof(impl->audio_ring));
  memset(impl->mel_frames, 0, sizeof(impl->mel_frames));
  memset(impl->embed_ring, 0, sizeof(impl->embed_ring));
#else
  (void)impl;
#endif
}

const wake_kws_backend_ops_t wake_kws_openwakeword_ops = {
    "openwakeword",
    "OpenWakeWord (mel -> embedding -> classifier, onnxruntime)",
    openwakeword_create, openwakeword_destroy, openwakeword_load,
    openwakeword_process_frame, openwakeword_reset};
