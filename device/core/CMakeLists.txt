# SDK core — target-agnostic C++17 with a strict C ABI (ADR-040 §1).
add_library(wake_sdk_core STATIC
  src/sdk.cxx
  src/registry.cxx
  src/detection.cxx
  src/afe_graph.cxx
)
target_include_directories(wake_sdk_core
  PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include
)
target_compile_features(wake_sdk_core PUBLIC cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  # Freestanding-friendly: no exceptions, no RTTI (ADR-040 §1).
  target_compile_options(wake_sdk_core PRIVATE
    -fno-exceptions -fno-rtti -Wall -Wextra -Wpedantic
  )
endif()
