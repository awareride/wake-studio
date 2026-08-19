# openwakeword module — device target (ADR-021/040 §2, issue #192).

# Optional onnxruntime C API runtime: -DWAKE_SDK_OPENWAKEWORD_HAS_RUNTIME=ON.
# Default OFF — the driver compiles and registers without it; load() reports
# "runtime not linked" and process_frame() stays in warmup. The prebuilt
# onnxruntime (pinned release, ADR-031 style) is fetched into
# third_party/onnxruntime/<host> by scripts/fetch-onnxruntime.mjs (issue #192;
# kws-streaming #194 shares the same dependency).
option(WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME "Link the onnxruntime C API runtime" OFF)

add_library(wake_kws_openwakeword STATIC src/openwakeword_driver.c)
target_link_libraries(wake_kws_openwakeword PUBLIC wake_sdk_core)

if(WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME)
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

  target_compile_definitions(wake_kws_openwakeword
    PRIVATE WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME=1)
  target_include_directories(wake_kws_openwakeword
    PUBLIC "${_ort_root}/include")
  target_link_libraries(wake_kws_openwakeword
    PUBLIC "${_ort_root}/lib/${_ort_lib}")
  # Consumers (test binaries, bundles) must find the runtime at load time.
  target_link_options(wake_kws_openwakeword
    INTERFACE "-Wl,-rpath,${_ort_root}/lib")
endif()
