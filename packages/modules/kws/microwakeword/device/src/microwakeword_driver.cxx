/*
 * microwakeword_driver.cxx — micro-wake-word device driver (issue #185).
 *
 * C KWSBackend adapter for the MCU-tier backend (ADR-020/019): the
 * micro-wake-word streaming int8 model over TFLite-Micro. The TU is C++
 * (TFLite-Micro requires C++); the registered op-struct stays C ABI
 * (wake/kws_backend.h).
 *
 * Pipeline (parity with the deployed references):
 *   16 kHz int16 frames -> microfrontend C frontend (30 ms window, 10 ms
 *   step, 40 channels, 125-7500 Hz, noise reduction + PCAN + log — the exact
 *   training/inference config from esphome/micro-wake-word-models via
 *   esphome/components/micro_wake_word/{preprocessor_settings.h,
 *   micro_wake_word.cpp setup()/generate_features_()})
 *   -> one uint16 feature slice per 10 ms frame
 *   -> integer quantization ((u16 * 256 + 333) / 666 - 128, clamped to int8;
 *      ESPHome generate_features_() verbatim)
 *   -> MicroInterpreter Invoke() over the streaming graph (internal stream_*
 *      state carried by resource variables across invokes)
 *   -> uint8 output / 255 posterior (inference.py dequantize_output_data).
 *
 * Model file: <model_dir>/microwakeword.tflite (the driver reads the name it
 * declares, ADR-040 §4.1). The L1/CI model is okay_nabu.tflite staged under
 * that name (scripts/fetch-tflite-micro.mjs, slice 1).
 *
 * Runtime gating: WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME (CMake option, default
 * OFF). Without the runtime, load() reports "runtime not linked" and
 * process_frame() stays in warmup (-1) — the module still compiles and
 * registers, so the composition root and capabilities work end-to-end.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "wake/kws_backend.h"

#if defined(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)
#include "tensorflow/lite/experimental/microfrontend/lib/frontend.h"
#include "tensorflow/lite/experimental/microfrontend/lib/frontend_util.h"
#include "tensorflow/lite/micro/micro_allocator.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "tensorflow/lite/micro/micro_resource_variable.h"
#include "tensorflow/lite/schema/schema_generated.h"
#endif

/* Frontend (ESPHome preprocessor_settings.h + setup(), verified): 30 ms
 * window emitting one 40-feature slice per 10 ms; 125-7500 Hz; noise
 * reduction + PCAN + log with training-time parameters. */
#define MWW_SAMPLE_RATE 16000
#define MWW_WINDOW_MS 30
#define MWW_STEP_MS 10
#define MWW_NUM_CHANNELS 40
#define MWW_LOWER_BAND 125.0f
#define MWW_UPPER_BAND 7500.0f

/* Model contract (verified by parsing okay_nabu.tflite): int8 [1,1,40] in,
 * uint8 [1,1] out. */
#define MWW_MODEL_FILE "microwakeword.tflite"
#define MWW_NUM_OPS 13

/* Tensor arena: static, shared by host and MCU builds. Measured
 * arena_used_bytes() = 54384 on okay_nabu (host gcc build); 64 KB leaves
 * ~10 KB headroom for cross-target variance (reference kernels on both
 * profiles, so layouts match closely). If a future model overflows,
 * AllocateTensors fails loudly at load(). */
#define MWW_TENSOR_ARENA_SIZE (64 * 1024)

/* Resource-variable arena: the streaming graph carries its stream_* state in
 * resource variables (VAR_HANDLE/READ_VARIABLE/ASSIGN_VARIABLE + a CALL_ONCE
 * init subgraph). TFLM requires an explicit MicroResourceVariables backed by
 * its own allocator (ESPHome streaming_model.cpp pattern); sized generously
 * for the ~20 state tensors — allocation fails loudly if ever short. */
#define MWW_VAR_ARENA_SIZE (8 * 1024)
#define MWW_MAX_VARIABLES 32

typedef struct microwakeword_impl {
  int loaded;
#if defined(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)
  struct FrontendState frontend;
  int frontend_ready;
  tflite::MicroMutableOpResolver<MWW_NUM_OPS> *resolver;
  tflite::MicroAllocator *var_allocator;
  tflite::MicroResourceVariables *resource_variables;
  tflite::MicroInterpreter *interpreter;
  uint8_t tensor_arena[MWW_TENSOR_ARENA_SIZE];
  uint8_t var_arena[MWW_VAR_ARENA_SIZE];
  uint8_t *model_data;
#endif
} microwakeword_impl_t;

#if defined(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)

/* Read a whole file into a malloc'd buffer (the 115 KB model). */
static int read_file(const char *path, uint8_t **out_data, size_t *out_size) {
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
  uint8_t *data = (uint8_t *)malloc((size_t)size);
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

/* Register exactly the ops the okay_nabu graph uses (verified by parsing
 * the model plus the runtime's loud missing-op errors: AllocateTensors
 * fails if the set ever goes stale).
 * Superset reference: ESPHome register_streaming_ops_ (20 ops for all
 * models incl. v2). */
static int register_ops(tflite::MicroMutableOpResolver<MWW_NUM_OPS> *r) {
  if (r->AddConcatenation() != kTfLiteOk) return 1;
  if (r->AddConv2D() != kTfLiteOk) return 1;
  if (r->AddFullyConnected() != kTfLiteOk) return 1;
  if (r->AddLogistic() != kTfLiteOk) return 1;
  if (r->AddMul() != kTfLiteOk) return 1;
  if (r->AddAdd() != kTfLiteOk) return 1;
  if (r->AddReshape() != kTfLiteOk) return 1;
  if (r->AddStridedSlice() != kTfLiteOk) return 1;
  if (r->AddQuantize() != kTfLiteOk) return 1;
  if (r->AddCallOnce() != kTfLiteOk) return 1;
  if (r->AddVarHandle() != kTfLiteOk) return 1;
  if (r->AddReadVariable() != kTfLiteOk) return 1;
  if (r->AddAssignVariable() != kTfLiteOk) return 1;
  return 0;
}

/* Frontend config: C defaults, then the training-time overrides (ESPHome
 * MicroWakeWord::setup() verbatim). */
static void fill_frontend_config(struct FrontendConfig *cfg) {
  FrontendFillConfigWithDefaults(cfg);
  cfg->window.size_ms = MWW_WINDOW_MS;
  cfg->window.step_size_ms = MWW_STEP_MS;
  cfg->filterbank.num_channels = MWW_NUM_CHANNELS;
  cfg->filterbank.lower_band_limit = MWW_LOWER_BAND;
  cfg->filterbank.upper_band_limit = MWW_UPPER_BAND;
  /* noise_reduction: training defaults (smoothing 10/0.025/0.06, min signal
   * remaining 0.05) already match; leave at FillConfig defaults. */
  cfg->pcan_gain_control.enable_pcan = 1;
  cfg->pcan_gain_control.strength = 0.95f;
  cfg->pcan_gain_control.offset = 80.0f;
  cfg->pcan_gain_control.gain_bits = 21;
  cfg->log_scale.enable_log = 1;
  cfg->log_scale.scale_shift = 6;
}

#endif /* WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME */

static void *microwakeword_create(const wake_kws_config_t *cfg) {
  (void)cfg;
#if defined(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)
  microwakeword_impl_t *impl =
      (microwakeword_impl_t *)calloc(1, sizeof(microwakeword_impl_t));
  if (impl == NULL) {
    return NULL;
  }
  impl->resolver =
      new (std::nothrow) tflite::MicroMutableOpResolver<MWW_NUM_OPS>();
  if (impl->resolver == NULL) {
    free(impl);
    return NULL;
  }
  if (register_ops(impl->resolver) != 0) {
    delete impl->resolver;
    free(impl);
    return NULL;
  }
  return impl;
#else
  return calloc(1, sizeof(microwakeword_impl_t));
#endif
}

static void microwakeword_destroy(void *v) {
  microwakeword_impl_t *impl = (microwakeword_impl_t *)v;
  if (impl == NULL) {
    return;
  }
#if defined(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)
  delete impl->interpreter;
  impl->interpreter = NULL;
  /* var_allocator/resource_variables live in the static var_arena — nothing
   * to free. */
  impl->var_allocator = NULL;
  impl->resource_variables = NULL;
  delete impl->resolver;
  impl->resolver = NULL;
  if (impl->frontend_ready) {
    FrontendFreeStateContents(&impl->frontend);
    impl->frontend_ready = 0;
  }
  free(impl->model_data);
  impl->model_data = NULL;
#endif
  free(impl);
}

static int microwakeword_load(void *v, const wake_model_bundle_t *models,
                              const wake_kws_config_t *cfg) {
  (void)cfg;
  microwakeword_impl_t *impl = (microwakeword_impl_t *)v;
#if defined(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)
  if (models == NULL || models->model_dir == NULL) {
    return 1;
  }

  char path[1024];
  snprintf(path, sizeof(path), "%s/%s", models->model_dir, MWW_MODEL_FILE);
  size_t size = 0;
  if (read_file(path, &impl->model_data, &size) != 0) {
    fprintf(stderr, "[microwakeword] cannot read model %s\n", path);
    return 1;
  }
  const tflite::Model *model = tflite::GetModel(impl->model_data);
  if (model->version() != TFLITE_SCHEMA_VERSION) {
    fprintf(stderr, "[microwakeword] bad schema version\n");
    free(impl->model_data);
    impl->model_data = NULL;
    return 1;
  }

  struct FrontendConfig fcfg;
  fill_frontend_config(&fcfg);
  if (!FrontendPopulateState(&fcfg, &impl->frontend, MWW_SAMPLE_RATE)) {
    fprintf(stderr, "[microwakeword] FrontendPopulateState failed\n");
    free(impl->model_data);
    impl->model_data = NULL;
    return 1;
  }
  impl->frontend_ready = 1;

  /* Streaming state lives in resource variables — explicit allocator +
   * variable table (ESPHome StreamingModel::load_model_() pattern). Both
   * are arena-allocated (no heap, no teardown beyond the arenas). */
  impl->var_allocator = tflite::MicroAllocator::Create(
      impl->var_arena, MWW_VAR_ARENA_SIZE);
  if (impl->var_allocator == NULL) {
    fprintf(stderr, "[microwakeword] var allocator create failed\n");
    goto fail;
  }
  impl->resource_variables = tflite::MicroResourceVariables::Create(
      impl->var_allocator, MWW_MAX_VARIABLES);
  if (impl->resource_variables == NULL) {
    fprintf(stderr, "[microwakeword] resource variables create failed\n");
    goto fail;
  }

  impl->interpreter = new (std::nothrow) tflite::MicroInterpreter(
      model, *impl->resolver, impl->tensor_arena, MWW_TENSOR_ARENA_SIZE,
      impl->resource_variables);
  if (impl->interpreter == NULL) {
    fprintf(stderr, "[microwakeword] interpreter alloc failed\n");
    goto fail;
  }
  if (impl->interpreter->AllocateTensors() != kTfLiteOk) {
    fprintf(stderr, "[microwakeword] AllocateTensors failed\n");
    goto fail;
  }

  /* Verify the model honors the declared contract (ESPHome load_model_
   * checks): int8 3-D input with 40 features, uint8 1x1 output. Dim [1]
   * is the model stride and may vary — only [0] and [2] are pinned. */
  {
    TfLiteTensor *input = impl->interpreter->input(0);
    TfLiteTensor *output = impl->interpreter->output(0);
    if (input->dims->size != 3 || input->dims->data[0] != 1 ||
        input->dims->data[2] != MWW_NUM_CHANNELS || input->type != kTfLiteInt8) {
      fprintf(stderr, "[microwakeword] unexpected input tensor\n");
      goto fail;
    }
    if (output->dims->size != 2 || output->dims->data[0] != 1 ||
        output->dims->data[1] != 1 || output->type != kTfLiteUInt8) {
      fprintf(stderr, "[microwakeword] unexpected output tensor\n");
      goto fail;
    }
  }

  impl->loaded = 1;
  return 0;

fail:
  delete impl->interpreter;
  impl->interpreter = NULL;
  FrontendFreeStateContents(&impl->frontend);
  impl->frontend_ready = 0;
  free(impl->model_data);
  impl->model_data = NULL;
  return 1;
#else
  (void)impl;
  return 1; /* TFLite-Micro runtime not linked in this build */
#endif
}

static float microwakeword_process_frame(void *v, const int16_t *samples,
                                         size_t n) {
  microwakeword_impl_t *impl = (microwakeword_impl_t *)v;
  (void)samples;
  (void)n;
#if defined(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)
  if (!impl->loaded || samples == NULL) {
    return -1.0f; /* warmup */
  }

  /* The frontend buffers internally and emits one 40-feature slice per
   * 10 ms step; the first two frames only fill the 30 ms window. */
  size_t read = 0;
  struct FrontendOutput out = FrontendProcessSamples(&impl->frontend, samples,
                                                     n, &read);
  (void)read;
  if (out.size == 0 || out.values == NULL) {
    return -1.0f; /* warmup — window not full yet */
  }
  if (out.size != MWW_NUM_CHANNELS) {
    return -1.0f; /* shape drift — never fabricate */
  }

  /* Integer feature quantization, ESPHome generate_features_() verbatim:
   * the frontend emits uint16 in roughly [0,670]; training divides by 25.6
   * (floats in [0,26]) and the int8 quantizer maps that onto [-128,127]:
   * input = (feature * 256) / 666 - 128, computed in 32-bit int math. */
  int8_t features[MWW_NUM_CHANNELS];
  for (size_t i = 0; i < MWW_NUM_CHANNELS; ++i) {
    int32_t value =
        ((int32_t)out.values[i] * 256 + (666 / 2)) / 666 - 128;
    if (value < -128) value = -128;
    if (value > 127) value = 127;
    features[i] = (int8_t)value;
  }

  TfLiteTensor *input = impl->interpreter->input(0);
  memcpy(tflite::GetTensorData<int8_t>(input), features, sizeof(features));
  if (impl->interpreter->Invoke() != kTfLiteOk) {
    fprintf(stderr, "[microwakeword] Invoke failed\n");
    return -1.0f;
  }

  /* uint8 output in [0,255]; dequantize per inference.py
   * (dequantize_output_data: q / 255). */
  TfLiteTensor *output = impl->interpreter->output(0);
  float score = (float)tflite::GetTensorData<uint8_t>(output)[0] / 255.0f;
  if (score < 0.0f) score = 0.0f;
  if (score > 1.0f) score = 1.0f;
  return score;
#else
  (void)impl;
  return -1.0f; /* warmup — runtime not linked */
#endif
}

static void microwakeword_reset(void *v) {
  microwakeword_impl_t *impl = (microwakeword_impl_t *)v;
#if defined(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)
  /* Clear the streaming state; the model stays loaded. The frontend needs a
   * fresh 30 ms window, so the next two frames report warmup again. Note
   * this is not bit-identical to a fresh load by upstream design:
   * FrontendReset has no PCAN/log counterpart (slow noise adaptation
   * persists across utterances, which is desirable), and interpreter Reset()
   * zeroes variable tensors while a fresh load runs the CALL_ONCE init
   * subgraph. The detection loop only needs warmup-then-live scores. */
  FrontendReset(&impl->frontend);
  if (impl->interpreter != NULL) {
    impl->interpreter->Reset();
  }
#else
  impl->loaded = 0;
#endif
}

extern "C" const wake_kws_backend_ops_t wake_kws_microwakeword_ops = {
    "microwakeword", "micro-wake-word (MCU, TFLite-Micro)",
    microwakeword_create, microwakeword_destroy, microwakeword_load,
    microwakeword_process_frame, microwakeword_reset};
