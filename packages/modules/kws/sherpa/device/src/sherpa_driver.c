/*
 * sherpa_driver.c — sherpa-onnx KWS device driver (issue #193).
 *
 * C KWSBackend adapter for the ASR-Decoding category (ADR-024): real KWS
 * transducer via sherpa-onnx's KeywordSpotter (streaming transducer tuned
 * for fixed wake words). The browser runs the same library compiled to wasm
 * (`core/backend.ts` is the reference); on device the same C API runs the
 * encoder/decoder/joiner onnx models directly.
 *
 * Pipeline (browser parity, backend.ts):
 *   AFE 16 kHz frames -> SherpaOnnxOnlineStreamAcceptWaveform
 *   -> (ready) DecodeKeywordStream -> GetKeywordResult
 *   -> keyword string -> binary score: 1.0 on a hit (held ~400 ms so the
 *     engine's min-duration gate clears), else 0.0. The generic detection
 *     loop (smoothing/threshold/cooldown) lives in the core.
 *
 * Model files are read from the bundle's model_dir with the names this
 * driver declares (ADR-040 §4.1):
 *   <model_dir>/encoder.onnx   <model_dir>/decoder.onnx
 *   <model_dir>/joiner.onnx    <model_dir>/tokens.txt
 *   <model_dir>/keywords.txt   (keyword list; spec-driven — sherpa phone
 *                               format "L AY1 T AH1 P @LIGHT_UP", one per line)
 *
 * Runtime gating: WAKE_SDK_SHERPA_HAS_RUNTIME (CMake option, default OFF).
 * Without the runtime, load() reports "runtime not linked" and
 * process_frame() stays in warmup (-1) — the module still compiles and
 * registers, so the composition root and capabilities work end-to-end.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "wake/kws_backend.h"

#if defined(WAKE_SDK_SHERPA_HAS_RUNTIME)
#include "sherpa-onnx/c-api/c-api.h"
#endif

typedef struct sherpa_impl {
  int loaded;
#if defined(WAKE_SDK_SHERPA_HAS_RUNTIME)
  const SherpaOnnxKeywordSpotter *spotter;
  const SherpaOnnxOnlineStream *stream;
  int hold_frames; /* post-hit hold, browser parity (40 frames = 400 ms) */
  float frame_buf[160]; /* int16 -> float [-1,1] conversion scratch */
#endif
} sherpa_impl_t;

#if defined(WAKE_SDK_SHERPA_HAS_RUNTIME)

/* Browser-parity config (backend.ts load()): feat 16000/80, cpu EP,
 * maxActivePaths 4, numTrailingBlanks 1, keywordsScore 1.0,
 * keywordsThreshold 0.25. */

/* The config holds raw pointers to the model path strings; the buffers must
 * stay alive until SherpaOnnxCreateKeywordSpotter has copied them (it loads
 * eagerly). fill_config() fills a caller-owned struct so the strings are not
 * local to this function. */
typedef struct sherpa_model_paths {
  char encoder[1024];
  char decoder[1024];
  char joiner[1024];
  char tokens[1024];
  char keywords[1024];
} sherpa_model_paths_t;

static void fill_config(SherpaOnnxKeywordSpotterConfig *config,
                        sherpa_model_paths_t *paths, const char *dir) {
  snprintf(paths->encoder, sizeof(paths->encoder), "%s/encoder.onnx", dir);
  snprintf(paths->decoder, sizeof(paths->decoder), "%s/decoder.onnx", dir);
  snprintf(paths->joiner, sizeof(paths->joiner), "%s/joiner.onnx", dir);
  snprintf(paths->tokens, sizeof(paths->tokens), "%s/tokens.txt", dir);
  snprintf(paths->keywords, sizeof(paths->keywords), "%s/keywords.txt", dir);

  memset(config, 0, sizeof(*config));
  config->feat_config.sample_rate = 16000;
  config->feat_config.feature_dim = 80;
  config->model_config.transducer.encoder = paths->encoder;
  config->model_config.transducer.decoder = paths->decoder;
  config->model_config.transducer.joiner = paths->joiner;
  config->model_config.tokens = paths->tokens;
  config->model_config.provider = "cpu";
  config->model_config.num_threads = 1;
  config->max_active_paths = 4;
  config->num_trailing_blanks = 1;
  config->keywords_score = 1.0f;
  config->keywords_threshold = 0.25f;
  config->keywords_file = paths->keywords;
}

/* Check the bundle dir has every file the driver declares. */
static int model_files_present(const char *dir) {
  static const char *names[] = {
      "encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt",
      "keywords.txt", NULL};
  for (size_t i = 0; names[i] != NULL; ++i) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", dir, names[i]);
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
      fprintf(stderr, "[sherpa] missing model file %s\n", path);
      return 0;
    }
    fclose(f);
  }
  return 1;
}

#endif /* WAKE_SDK_SHERPA_HAS_RUNTIME */

static void *sherpa_create(const wake_kws_config_t *cfg) {
  (void)cfg;
  return calloc(1, sizeof(sherpa_impl_t));
}

static void sherpa_destroy(void *v) {
  sherpa_impl_t *impl = (sherpa_impl_t *)v;
  if (impl == NULL) {
    return;
  }
#if defined(WAKE_SDK_SHERPA_HAS_RUNTIME)
  if (impl->stream != NULL) {
    SherpaOnnxDestroyOnlineStream(impl->stream);
    impl->stream = NULL;
  }
  if (impl->spotter != NULL) {
    SherpaOnnxDestroyKeywordSpotter(impl->spotter);
    impl->spotter = NULL;
  }
#endif
  free(impl);
}

static int sherpa_load(void *v, const wake_model_bundle_t *models,
                       const wake_kws_config_t *cfg) {
  (void)cfg;
  sherpa_impl_t *impl = (sherpa_impl_t *)v;
#if defined(WAKE_SDK_SHERPA_HAS_RUNTIME)
  if (models == NULL || models->model_dir == NULL) {
    return 1;
  }
  if (!model_files_present(models->model_dir)) {
    return 1;
  }

  /* The config strings only need to live for the create call: sherpa-onnx
   * loads the models eagerly into memory. The path buffers are owned by
   * sherpa_model_paths_t, which stays alive through the create call. */
  sherpa_model_paths_t paths;
  SherpaOnnxKeywordSpotterConfig config;
  fill_config(&config, &paths, models->model_dir);

  impl->spotter = SherpaOnnxCreateKeywordSpotter(&config);
  if (impl->spotter == NULL) {
    fprintf(stderr, "[sherpa] SherpaOnnxCreateKeywordSpotter failed\n");
    return 1;
  }
  impl->stream = SherpaOnnxCreateKeywordStream(impl->spotter);
  if (impl->stream == NULL) {
    SherpaOnnxDestroyKeywordSpotter(impl->spotter);
    impl->spotter = NULL;
    fprintf(stderr, "[sherpa] SherpaOnnxCreateKeywordStream failed\n");
    return 1;
  }
  impl->loaded = 1;
  return 0;
#else
  (void)impl;
  (void)models;
  return 1; /* sherpa-onnx not linked in this build */
#endif
}

static float sherpa_process_frame(void *v, const int16_t *samples, size_t n) {
  sherpa_impl_t *impl = (sherpa_impl_t *)v;
#if defined(WAKE_SDK_SHERPA_HAS_RUNTIME)
  if (!impl->loaded || samples == NULL) {
    return -1.0f; /* warmup */
  }

  /* sherpa expects float samples in [-1, 1]. */
  size_t n32 = n > sizeof(impl->frame_buf) / sizeof(impl->frame_buf[0])
                   ? sizeof(impl->frame_buf) / sizeof(impl->frame_buf[0])
                   : n;
  for (size_t i = 0; i < n32; ++i) {
    impl->frame_buf[i] = (float)samples[i] * (1.0f / 32768.0f);
  }
  SherpaOnnxOnlineStreamAcceptWaveform(impl->stream, 16000, impl->frame_buf,
                                       (int32_t)n32);

  /* Hold a detected hit for the trigger min-duration window (browser
   * parity: 40 frames of 1.0 after a hit). */
  if (impl->hold_frames > 0) {
    impl->hold_frames -= 1;
    return 1.0f;
  }

  /* Decode as many ready chunks as the stream has buffered; reset only after
   * a hit (sherpa auto-resets after trailing silence; a mid-utterance reset
   * would wipe the encoder states and break multi-chunk keywords). */
  int hit = 0;
  while (SherpaOnnxIsKeywordStreamReady(impl->spotter, impl->stream)) {
    SherpaOnnxDecodeKeywordStream(impl->spotter, impl->stream);
    const SherpaOnnxKeywordResult *result =
        SherpaOnnxGetKeywordResult(impl->spotter, impl->stream);
    const char *keyword = result != NULL ? result->keyword : NULL;
    if (keyword != NULL && keyword[0] != '\0') {
      hit = 1;
    }
    if (result != NULL) {
      SherpaOnnxDestroyKeywordResult(result);
    }
    if (hit) {
      SherpaOnnxResetKeywordStream(impl->spotter, impl->stream);
      break;
    }
  }

  if (hit) {
    impl->hold_frames = 40; /* ~400 ms @ 10 ms frames */
    return 1.0f;
  }
  return 0.0f;
#else
  (void)impl;
  (void)samples;
  (void)n;
  return -1.0f; /* warmup — sherpa-onnx not linked */
#endif
}

static void sherpa_reset(void *v) {
  sherpa_impl_t *impl = (sherpa_impl_t *)v;
#if defined(WAKE_SDK_SHERPA_HAS_RUNTIME)
  impl->hold_frames = 0;
  if (impl->spotter != NULL && impl->stream != NULL) {
    SherpaOnnxResetKeywordStream(impl->spotter, impl->stream);
  }
#else
  (void)impl;
#endif
}

const wake_kws_backend_ops_t wake_kws_sherpa_ops = {
    "sherpa-onnx-kws",
    "sherpa-onnx KWS (transducer, sherpa-onnx C API)",
    sherpa_create, sherpa_destroy, sherpa_load, sherpa_process_frame,
    sherpa_reset};
