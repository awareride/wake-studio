# sherpa-onnx-kws module — device target (ADR-021/040 §2, issue #193).

# Optional sherpa-onnx runtime: -DWAKE_SDK_SHERPA_HAS_RUNTIME=ON.
# Default OFF — the driver compiles and registers without it; load() reports
# "runtime not linked" and process_frame() stays in warmup. The prebuilt
# sherpa-onnx shared library (pinned release, ADR-031 style) is fetched into
# third_party/sherpa-onnx/<host> by scripts/fetch-sherpa-onnx.mjs; it bundles
# its own onnxruntime, so no separate runtime is needed.
option(WAKE_SDK_SHERPA_HAS_RUNTIME "Link the sherpa-onnx C API runtime" OFF)

add_library(wake_kws_sherpa STATIC src/sherpa_driver.c)
target_link_libraries(wake_kws_sherpa PUBLIC wake_sdk_core)

if(WAKE_SDK_SHERPA_HAS_RUNTIME)
  set(WAKE_SDK_SHERPA_DIR "${WAKE_REPO_ROOT}/third_party/sherpa-onnx"
      CACHE PATH "sherpa-onnx prebuilt root (fetched; never committed)")
  if(APPLE)
    set(_sherpa_host osx-arm64)
    set(_sherpa_lib "libsherpa-onnx-c-api.dylib")
  elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64)$")
    set(_sherpa_host linux-aarch64)
    set(_sherpa_lib "libsherpa-onnx-c-api.so")
  else()
    set(_sherpa_host linux-x64)
    set(_sherpa_lib "libsherpa-onnx-c-api.so")
  endif()
  set(_sherpa_root "${WAKE_SDK_SHERPA_DIR}/${_sherpa_host}")

  if(NOT EXISTS "${_sherpa_root}/include/sherpa-onnx/c-api/c-api.h")
    message(FATAL_ERROR
      "sherpa-onnx not found at ${_sherpa_root} — run: "
      "node scripts/fetch-sherpa-onnx.mjs")
  endif()

  target_compile_definitions(wake_kws_sherpa
    PRIVATE WAKE_SDK_SHERPA_HAS_RUNTIME=1)
  target_include_directories(wake_kws_sherpa
    PUBLIC "${_sherpa_root}/include")
  target_link_libraries(wake_kws_sherpa
    PUBLIC "${_sherpa_root}/lib/${_sherpa_lib}")
  # Consumers (test binaries, bundles) must find the runtime (and the
  # onnxruntime it bundles) at load time.
  target_link_options(wake_kws_sherpa
    INTERFACE "-Wl,-rpath,${_sherpa_root}/lib")
endif()
