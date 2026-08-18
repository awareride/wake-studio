# ---------------------------------------------------------------------------
# SDK profile plumbing (ADR-040 §4): one core, two profiles — not forks.
#
#   -DWAKE_SDK_PROFILE=mcu   low-power: static buffers, no threads, int16 DSP
#   -DWAKE_SDK_PROFILE=app   high-performance: heap + threads + float DSP
#
# The profile selects compile-time feature macros; a runtime capability query
# (wake_sdk_capabilities, core) reports the build's reality to demos and the
# bundle generator.
# ---------------------------------------------------------------------------

set(WAKE_SDK_PROFILE "app" CACHE STRING "SDK build profile: mcu or app")
set_property(CACHE WAKE_SDK_PROFILE PROPERTY STRINGS mcu app)

if(WAKE_SDK_PROFILE STREQUAL "mcu")
  message(STATUS "wake-sdk: profile = mcu (static buffers, no threads, int16 DSP)")
  set(WAKE_SDK_HAVE_THREADS OFF)
  set(WAKE_SDK_HAVE_FLOAT_DSP OFF)
  set(WAKE_SDK_STATIC_BUFFERS ON)
  add_compile_definitions(WAKE_SDK_PROFILE_MCU=1)
else()
  message(STATUS "wake-sdk: profile = app (heap, threads, float DSP)")
  set(WAKE_SDK_HAVE_THREADS ON)
  set(WAKE_SDK_HAVE_FLOAT_DSP ON)
  set(WAKE_SDK_STATIC_BUFFERS OFF)
  add_compile_definitions(WAKE_SDK_PROFILE_APP=1)
endif()
