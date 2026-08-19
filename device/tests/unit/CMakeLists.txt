# L1 unit tests (native build, ADR-026 device world).
add_executable(sdk_unit_tests
  doctest_main.cxx
  detection.test.cxx
  registry.test.cxx
  afe_graph.test.cxx
  rnnoise.test.cxx
  microwakeword.test.cxx
  kws_streaming.test.cxx
)
target_link_libraries(sdk_unit_tests PRIVATE
  wake_sdk_core
  wake_afe_rnnoise
  wake_afe_aec
  wake_afe_bss
  wake_kws_microwakeword
  wake_kws_streaming
)
# The kws-streaming L1 test (issue #194) has two faces: the no-runtime
# contract test and, when the onnxruntime is linked, a real-inference test
# over the manifest-driven graph. The compile-time gate + model dir must
# match the module's own configuration.
if(WAKE_SDK_KWS_STREAMING_HAS_RUNTIME)
  target_compile_definitions(sdk_unit_tests PRIVATE WAKE_SDK_KWS_STREAMING_HAS_RUNTIME=1)
  set(WAKE_KWS_STREAMING_MODEL_DIR "" CACHE PATH
      "Directory holding model.onnx + manifest.json (L1 runtime test)")
  if(WAKE_KWS_STREAMING_MODEL_DIR)
    target_compile_definitions(sdk_unit_tests PRIVATE
      WAKE_KWS_STREAMING_MODEL_DIR="${WAKE_KWS_STREAMING_MODEL_DIR}")
  endif()
endif()
target_include_directories(sdk_unit_tests PRIVATE ${WAKE_REPO_ROOT}/third_party)
add_test(NAME sdk_unit COMMAND sdk_unit_tests)
