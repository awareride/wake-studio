# Host reference adapter (dev host: macOS/Linux).
#
#   wav_reader.c — minimal PCM16 WAV reader for the CLI demo + integration tests
#   rms_backend.c — reference KWS backend (loud-frame scoring, no model files)
add_library(wake_adapters_host STATIC
  wav_reader.c
  rms_backend.c
)
target_include_directories(wake_adapters_host PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/..)
target_link_libraries(wake_adapters_host PUBLIC wake_sdk_core)
