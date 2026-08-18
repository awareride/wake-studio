# wake-sdk-demo — host CLI demo (#182). Composes through the reference root.
add_executable(wake-sdk-demo main.c)
target_link_libraries(wake-sdk-demo PRIVATE
  wake_sdk_core
  wake_composition_host
  wake_adapters_host
)
