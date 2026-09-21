# microwakeword module — device target (ADR-021/040 §2, issue #185).

# Optional TFLite-Micro runtime: -DWAKE_SDK_MICROWAKEWORD_HAS_RUNTIME=ON.
# Default OFF — the driver module compiles and registers without it; load()
# reports "runtime not linked" and process_frame() stays in warmup.
# The driver TU is C++ (TFLite-Micro requires C++) behind the C KWSBackend
# op-struct (wake/kws_backend.h).
add_library(wake_kws_microwakeword STATIC src/microwakeword_driver.cxx)
target_link_libraries(wake_kws_microwakeword PUBLIC wake_sdk_core)

if(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)
  # Pinned TFLite-Micro source + flatbuffers headers, fetched (never
  # committed) by scripts/fetch-tflite-micro.mjs (slice 1).
  set(WAKE_SDK_TFLM_DIR "${WAKE_REPO_ROOT}/third_party/tflite-micro"
      CACHE PATH "TFLite-Micro source root (fetched; never committed)")
  set(WAKE_SDK_FLATBUFFERS_DIR "${WAKE_REPO_ROOT}/third_party/flatbuffers"
      CACHE PATH "flatbuffers headers root (fetched; never committed)")
  set(WAKE_SDK_GEMMLOWP_DIR "${WAKE_REPO_ROOT}/third_party/gemmlowp"
      CACHE PATH "gemmlowp fixedpoint root (fetched; never committed)")
  set(WAKE_SDK_RUY_DIR "${WAKE_REPO_ROOT}/third_party/ruy"
      CACHE PATH "ruy profiler root (fetched; never committed)")
  set(WAKE_SDK_KISSFFT_DIR "${WAKE_REPO_ROOT}/third_party/kissfft"
      CACHE PATH "kissfft root (fetched; never committed)")

  if(NOT EXISTS "${WAKE_SDK_TFLM_DIR}/tensorflow/lite/micro/micro_interpreter.h")
    message(FATAL_ERROR
      "TFLite-Micro not found at ${WAKE_SDK_TFLM_DIR} — run: "
      "node scripts/fetch-tflite-micro.mjs")
  endif()
  if(NOT EXISTS "${WAKE_SDK_FLATBUFFERS_DIR}/include/flatbuffers/flatbuffers.h")
    message(FATAL_ERROR
      "flatbuffers headers not found at ${WAKE_SDK_FLATBUFFERS_DIR} — run: "
      "node scripts/fetch-tflite-micro.mjs")
  endif()
  if(NOT EXISTS "${WAKE_SDK_GEMMLOWP_DIR}/fixedpoint/fixedpoint.h")
    message(FATAL_ERROR
      "gemmlowp fixedpoint not found at ${WAKE_SDK_GEMMLOWP_DIR} — run: "
      "node scripts/fetch-tflite-micro.mjs")
  endif()
  if(NOT EXISTS "${WAKE_SDK_RUY_DIR}/ruy/profiler/instrumentation.h")
    message(FATAL_ERROR
      "ruy profiler not found at ${WAKE_SDK_RUY_DIR} — run: "
      "node scripts/fetch-tflite-micro.mjs")
  endif()
  if(NOT EXISTS "${WAKE_SDK_KISSFFT_DIR}/kiss_fft.h")
    message(FATAL_ERROR
      "kissfft not found at ${WAKE_SDK_KISSFFT_DIR} — run: "
      "node scripts/fetch-tflite-micro.mjs")
  endif()

  # Curated TFLM build: interpreter core + memory planners + exactly the 13
  # kernels the okay_nabu graph uses (verified by parsing the model plus the
  # runtime's loud missing-op errors: Concatenation, Conv2D, FullyConnected,
  # Logistic, Mul, Add, Reshape, StridedSlice, Quantize, CallOnce, VarHandle,
  # ReadVariable, AssignVariable) + the microfrontend C frontend (signal
  # processing for the 40-feature/10 ms slices). Reference kernels only — no
  # CMSIS/NN variants, so host and Cortex-M share one code path.
  set(_tflm_core
    tensorflow/lite/array.cc
    tensorflow/lite/core/c/common.cc
    tensorflow/lite/core/api/flatbuffer_conversions.cc
    tensorflow/lite/core/api/tensor_utils.cc
    tensorflow/lite/kernels/kernel_util.cc
    tensorflow/lite/kernels/internal/quantization_util.cc
    tensorflow/lite/kernels/internal/common.cc
    tensorflow/lite/kernels/internal/tensor_ctypes.cc
    tensorflow/lite/kernels/internal/portable_tensor_utils.cc
    tensorflow/lite/micro/tflite_bridge/micro_error_reporter.cc
    tensorflow/lite/micro/tflite_bridge/flatbuffer_conversions_bridge.cc
    tensorflow/lite/micro/arena_allocator/non_persistent_arena_buffer_allocator.cc
    tensorflow/lite/micro/arena_allocator/persistent_arena_buffer_allocator.cc
    tensorflow/lite/micro/arena_allocator/single_arena_buffer_allocator.cc
    tensorflow/compiler/mlir/lite/core/api/error_reporter.cc
    tensorflow/compiler/mlir/lite/schema/schema_utils.cc
    tensorflow/lite/micro/micro_interpreter.cc
    tensorflow/lite/micro/micro_allocator.cc
    tensorflow/lite/micro/micro_allocation_info.cc
    tensorflow/lite/micro/micro_context.cc
    tensorflow/lite/micro/micro_interpreter_context.cc
    tensorflow/lite/micro/micro_interpreter_graph.cc
    tensorflow/lite/micro/micro_utils.cc
    tensorflow/lite/micro/micro_profiler.cc
    tensorflow/lite/micro/micro_resource_variable.cc
    tensorflow/lite/micro/micro_time.cc
    tensorflow/lite/micro/flatbuffer_utils.cc
    tensorflow/lite/micro/memory_helpers.cc
    tensorflow/lite/micro/micro_log.cc
    tensorflow/lite/micro/debug_log.cc
    tensorflow/lite/micro/system_setup.cc
    tensorflow/lite/micro/micro_op_resolver.cc
    tensorflow/lite/micro/memory_planner/greedy_memory_planner.cc
    tensorflow/lite/micro/memory_planner/linear_memory_planner.cc
    tensorflow/lite/micro/memory_planner/non_persistent_buffer_planner_shim.cc
  )
  set(_tflm_kernels
    tensorflow/lite/micro/kernels/add.cc
    tensorflow/lite/micro/kernels/add_common.cc
    tensorflow/lite/micro/kernels/conv.cc
    tensorflow/lite/micro/kernels/conv_common.cc
    tensorflow/lite/micro/kernels/fully_connected.cc
    tensorflow/lite/micro/kernels/fully_connected_common.cc
    tensorflow/lite/micro/kernels/logistic.cc
    tensorflow/lite/micro/kernels/logistic_common.cc
    tensorflow/lite/micro/kernels/mul.cc
    tensorflow/lite/micro/kernels/mul_common.cc
    tensorflow/lite/micro/kernels/reshape.cc
    tensorflow/lite/micro/kernels/reshape_common.cc
    tensorflow/lite/micro/kernels/strided_slice.cc
    tensorflow/lite/micro/kernels/strided_slice_common.cc
    tensorflow/lite/micro/kernels/concatenation.cc
    tensorflow/lite/micro/kernels/quantize.cc
    tensorflow/lite/micro/kernels/quantize_common.cc
    tensorflow/lite/micro/kernels/call_once.cc
    tensorflow/lite/micro/kernels/var_handle.cc
    tensorflow/lite/micro/kernels/read_variable.cc
    tensorflow/lite/micro/kernels/assign_variable.cc
    tensorflow/lite/micro/kernels/kernel_util.cc
  )
  set(_tflm_frontend
    tensorflow/lite/experimental/microfrontend/lib/frontend.c
    tensorflow/lite/experimental/microfrontend/lib/frontend_util.c
    tensorflow/lite/experimental/microfrontend/lib/window.c
    tensorflow/lite/experimental/microfrontend/lib/window_util.c
    tensorflow/lite/experimental/microfrontend/lib/fft.cc
    tensorflow/lite/experimental/microfrontend/lib/kiss_fft_int16.cc
    tensorflow/lite/experimental/microfrontend/lib/fft_util.cc
    tensorflow/lite/experimental/microfrontend/lib/filterbank.c
    tensorflow/lite/experimental/microfrontend/lib/filterbank_util.c
    tensorflow/lite/experimental/microfrontend/lib/noise_reduction.c
    tensorflow/lite/experimental/microfrontend/lib/noise_reduction_util.c
    tensorflow/lite/experimental/microfrontend/lib/pcan_gain_control.c
    tensorflow/lite/experimental/microfrontend/lib/pcan_gain_control_util.c
    tensorflow/lite/experimental/microfrontend/lib/log_scale.c
    tensorflow/lite/experimental/microfrontend/lib/log_scale_util.c
    tensorflow/lite/experimental/microfrontend/lib/log_lut.c
  )
  set(_tflm_srcs "")
  foreach(f IN LISTS _tflm_core _tflm_kernels _tflm_frontend)
    list(APPEND _tflm_srcs "${WAKE_SDK_TFLM_DIR}/${f}")
  endforeach()
  # ruy profiler (linked by the reference kernels' ScopeLabel instrumentation)
  list(APPEND _tflm_srcs "${WAKE_SDK_RUY_DIR}/ruy/profiler/instrumentation.cc")

  add_library(tflite_micro STATIC ${_tflm_srcs})
  target_include_directories(tflite_micro PUBLIC
    "${WAKE_SDK_TFLM_DIR}"
    "${WAKE_SDK_FLATBUFFERS_DIR}/include"
    "${WAKE_SDK_GEMMLOWP_DIR}"
    "${WAKE_SDK_RUY_DIR}"
    "${WAKE_SDK_KISSFFT_DIR}"
  )
  target_compile_features(tflite_micro PUBLIC cxx_std_17)
  if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    # TFLM forbids exceptions/RTTI (same posture as wake_sdk_core).
    target_compile_options(tflite_micro PRIVATE -fno-exceptions -fno-rtti)
  endif()

  target_compile_definitions(wake_kws_microwakeword
    PRIVATE WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME=1)
  target_link_libraries(wake_kws_microwakeword PUBLIC tflite_micro)
endif()
