cmake_minimum_required(VERSION 3.20)
project(wake-studio-sdk LANGUAGES C CXX)

# ---------------------------------------------------------------------------
# WakeStudio device-side SDK (ADR-021 / ADR-040)
#
# Aggregation tree, not a mirror of the modules: the SDK core lives here, and
# each module's on-device code lives inside its module
# (packages/modules/<category>/<name>/device/). The bundle generator (issue
# #189) emits the module list; the reference module is wired below.
#
# Profiles (ADR-040 §4): -DWAKE_SDK_PROFILE=mcu|app (default app).
# ---------------------------------------------------------------------------

include(cmake/sdk-options.cmake)

# Repository root (for third_party includes and module device/ paths).
set(WAKE_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/..")

# --- core (target-agnostic) ------------------------------------------------
add_subdirectory(core)

# --- module device/ trees (ADR-040 §2) --------------------------------------
# Device code lives inside each module; the top-level tree aggregates the
# selected modules. Each entry needs a unique binary dir.
add_subdirectory(
  ../packages/modules/kws/microwakeword/device
  ${CMAKE_BINARY_DIR}/modules/kws/microwakeword
)
add_subdirectory(
  ../packages/modules/afe/rnnoise/device
  ${CMAKE_BINARY_DIR}/modules/afe/rnnoise
)
add_subdirectory(
  ../packages/modules/afe/aec/device
  ${CMAKE_BINARY_DIR}/modules/afe/aec
)
add_subdirectory(
  ../packages/modules/afe/bss/device
  ${CMAKE_BINARY_DIR}/modules/afe/bss
)

# --- composition roots (ADR-040 §3) -----------------------------------------
add_subdirectory(composition)

# --- target adapters --------------------------------------------------------
add_subdirectory(adapters)

# --- tools -------------------------------------------------------------------
add_subdirectory(tools)

# --- tests (L1 unit + composition-root integration, ADR-026) ---------------
enable_testing()
add_subdirectory(tests)
