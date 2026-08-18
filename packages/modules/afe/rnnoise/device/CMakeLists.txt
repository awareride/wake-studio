# RNNoise module — device target (ADR-021/040 §2).
#
# Vendored upstream: third_party/rnnoise (v0.1.1, BSD-3, pinned — see
# third_party/rnnoise/README.md). This target builds the rnnoise library +
# the AFE NS/VAD stage (`wake_afe_ns_ops`) wired into the device CMake tree
# via the top-level `device/` aggregation.
add_library(wake_afe_rnnoise STATIC
  ${WAKE_REPO_ROOT}/third_party/rnnoise/src/denoise.c
  ${WAKE_REPO_ROOT}/third_party/rnnoise/src/rnn.c
  ${WAKE_REPO_ROOT}/third_party/rnnoise/src/rnn_data.c
  ${WAKE_REPO_ROOT}/third_party/rnnoise/src/rnn_reader.c
  ${WAKE_REPO_ROOT}/third_party/rnnoise/src/pitch.c
  ${WAKE_REPO_ROOT}/third_party/rnnoise/src/kiss_fft.c
  ${WAKE_REPO_ROOT}/third_party/rnnoise/src/celt_lpc.c
  src/ns_stage.c
)

target_include_directories(wake_afe_rnnoise
  PUBLIC ${WAKE_REPO_ROOT}/third_party/rnnoise/include
  PRIVATE ${WAKE_REPO_ROOT}/third_party/rnnoise/src
)

# Inherit the SDK core's public include dirs (wake/ headers).
target_link_libraries(wake_afe_rnnoise PUBLIC wake_sdk_core)

# Vendored upstream: silence warnings for pristine code (not ours to fix).
if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(wake_afe_rnnoise PRIVATE -w)
endif()

if(NOT WIN32)
  target_link_libraries(wake_afe_rnnoise PRIVATE m) # rnnoise uses libm
endif()
