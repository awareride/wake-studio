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

# Everything is PIC from the start: the shared binding library (Python
# ctypes, #187) links every static lib, and Linux ld rejects non-PIC objects
# in a .so (relocation against 'common'). Safe for static executables too.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

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
# --- target adapters / tools / tests are HOST-ONLY (stdio/OS) ----------------
if(NOT CMAKE_CROSSCOMPILING)
  add_subdirectory(composition)
  add_subdirectory(adapters)
  add_subdirectory(tools)
  enable_testing()
  add_subdirectory(tests)

  # Shared library for language bindings (Python ctypes, #187). Anchored on
  # the composition root so wake_sdk_compose() is part of the public surface.
  # The core is force-loaded so the whole public API ships in the dylib (a
  # linker would otherwise only pull objects the anchor references).
  add_library(wake_sdk_shared SHARED composition/host_root.c)
  target_include_directories(wake_sdk_shared PUBLIC core/include)
  target_link_libraries(wake_sdk_shared PRIVATE
    wake_sdk_core
    wake_composition_host
    wake_adapters_host
  )
  if(APPLE)
    target_link_options(wake_sdk_shared PRIVATE
      "-Wl,-force_load,$<TARGET_FILE:wake_sdk_core>")
  else()
    target_link_options(wake_sdk_shared PRIVATE
      "-Wl,--whole-archive" "$<TARGET_FILE:wake_sdk_core>"
      "-Wl,--no-whole-archive")
  endif()
  set_target_properties(wake_sdk_shared PROPERTIES OUTPUT_NAME wake_sdk)
endif()
