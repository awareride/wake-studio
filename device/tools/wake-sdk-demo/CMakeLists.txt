# wake-sdk-demo — host CLI demo (#182).
add_executable(wake-sdk-demo main.c)
target_link_libraries(wake-sdk-demo PRIVATE
  wake_sdk_core
  wake_afe_rnnoise
  wake_afe_aec
  wake_afe_bss
  wake_adapters_host
)
