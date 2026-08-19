# Composition-root integration tests (native harness, #182).
add_executable(sdk_integration_tests
  ../unit/doctest_main.cxx
  pipeline.test.cxx
)
target_link_libraries(sdk_integration_tests PRIVATE
  wake_sdk_core
  wake_composition_host
  wake_adapters_host
)
target_include_directories(sdk_integration_tests
  PRIVATE ${WAKE_REPO_ROOT}/third_party
)
add_test(NAME sdk_integration COMMAND sdk_integration_tests)
