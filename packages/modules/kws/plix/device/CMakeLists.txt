# plix module — device target (ADR-021/040 §2, issue #188).

# Optional onnxruntime C API runtime: -DWAKE_SDK_PLIX_HAS_RUNTIME=ON.
# Default OFF — the driver compiles and registers without it; load() reports
# "runtime not linked" and process_frame() stays in warmup. The prebuilt
# onnxruntime (pinned 1.21.0, ADR-031 style) is fetched into
# third_party/onnxruntime/<host> by scripts/fetch-onnxruntime.mjs — the same
# shared app-class runtime as openwakeword (#192) and kws-streaming (#194).
option(WAKE_SDK_PLIX_HAS_RUNTIME "Link the onnxruntime C API runtime" OFF)

add_library(wake_kws_plix STATIC src/plix_driver.c)
target_link_libraries(wake_kws_plix PUBLIC wake_sdk_core)

if(WAKE_SDK_PLIX_HAS_RUNTIME)
  set(WAKE_SDK_KISSFFT_DIR "${WAKE_REPO_ROOT}/third_party/kissfft"
      CACHE PATH "kissfft root (fetched; never committed)")
  if(NOT EXISTS "${WAKE_SDK_KISSFFT_DIR}/kiss_fft.h")
    message(FATAL_ERROR
      "kissfft not found at ${WAKE_SDK_KISSFFT_DIR} — run: "
      "node scripts/fetch-tflite-micro.mjs")
  endif()

  set(WAKE_SDK_ONNXRUNTIME_DIR "${WAKE_REPO_ROOT}/third_party/onnxruntime"
      CACHE PATH "onnxruntime prebuilt root (fetched; never committed)")
  if(APPLE)
    set(_ort_host osx-universal2)
    set(_ort_lib "libonnxruntime.dylib")
  elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64)$")
    set(_ort_host linux-aarch64)
    set(_ort_lib "libonnxruntime.so")
  else()
    set(_ort_host linux-x64)
    set(_ort_lib "libonnxruntime.so")
  endif()
  set(_ort_root "${WAKE_SDK_ONNXRUNTIME_DIR}/${_ort_host}")

  if(NOT EXISTS "${_ort_root}/include/onnxruntime_c_api.h")
    message(FATAL_ERROR
      "onnxruntime not found at ${_ort_root} — run: "
      "node scripts/fetch-onnxruntime.mjs")
  endif()

  target_compile_definitions(wake_kws_plix
    PRIVATE WAKE_SDK_PLIX_HAS_RUNTIME=1)
  target_include_directories(wake_kws_plix
    PUBLIC "${_ort_root}/include")
  # C mel frontend (slice 2a): pure C99 + kissfft, no onnxruntime dep, but
  # gated on the runtime build so OFF builds stay third_party-free.
  target_include_directories(wake_kws_plix
    PRIVATE "${WAKE_SDK_KISSFFT_DIR}")
  target_sources(wake_kws_plix PRIVATE src/plix_frontend.c)
  target_link_libraries(wake_kws_plix
    PUBLIC "${_ort_root}/lib/${_ort_lib}")
  # Consumers (test binaries, bundles) must find the runtime at load time.
  target_link_options(wake_kws_plix
    INTERFACE "-Wl,-rpath,${_ort_root}/lib")
endif()
