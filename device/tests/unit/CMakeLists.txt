# L1 unit tests (native build, ADR-026 device world).
add_executable(sdk_unit_tests
  doctest_main.cxx
  detection.test.cxx
  registry.test.cxx
  afe_graph.test.cxx
  rnnoise.test.cxx
  microwakeword.test.cxx
)
target_link_libraries(sdk_unit_tests PRIVATE
  wake_sdk_core
  wake_afe_rnnoise
  wake_afe_aec
  wake_afe_bss
  wake_kws_microwakeword
)
target_include_directories(sdk_unit_tests PRIVATE ${WAKE_REPO_ROOT}/third_party)
add_test(NAME sdk_unit COMMAND sdk_unit_tests)
