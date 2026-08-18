# microwakeword module — device target (ADR-021/040 §2, issue #185).

# Optional TFLite-Micro runtime: -DWAKE_SDK_MICROWAKEWORD_HAS_RUNTIME=ON.
# Default OFF — the driver module compiles and registers without it; load()
# reports "runtime not linked" and process_frame() stays in warmup.
option(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME "Link the TFLite-Micro runtime" OFF)

add_library(wake_kws_microwakeword STATIC src/microwakeword_driver.c)
target_link_libraries(wake_kws_microwakeword PUBLIC wake_sdk_core)

if(WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME)
  target_compile_definitions(wake_kws_microwakeword
    PRIVATE WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME=1)
  # TFLite-Micro sources land here (pinned third_party/tflite-micro) with the
  # runtime integration; see README.
endif()
