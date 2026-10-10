# AFE quality harness (issue #247, slice A)
#
# Two executables:
#   afe_quality_run   production run -> must PASS (exit 0)
#   afe_quality_run --known-bad  negative control -> must FAIL (exit 1)
#
# The second one is the point: it runs the pre-#244 device NS stage with 16 kHz
# audio mislabeled as 48 kHz, i.e. the #240 B2 defect, and CI asserts it fails. A
# quality gate that cannot fail on a known-bad build is decoration.
add_executable(afe_quality_run
  corpus.cxx
  metrics.cxx
  known_bad_stage.cxx
  run_ns.cxx
)
target_link_libraries(afe_quality_run PRIVATE
  wake_sdk_core
  wake_afe_rnnoise
)
target_include_directories(afe_quality_run
  PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}
)

# Production gate: a regression becomes a red build, not a number in a log.
add_test(NAME afe_quality_ns COMMAND afe_quality_run)

# Negative control: the known-bad build MUST fail. PASS_REGULAR_EXPRESSION would
# be wrong here -- we want the opposite -- so the test asserts a non-zero exit by
# inverting it in a tiny wrapper target.
add_executable(afe_quality_expect_fail
  expect_fail.cxx
)
# Build-order dependency only: the wrapper invokes the harness as a subprocess.
add_dependencies(afe_quality_expect_fail afe_quality_run)
add_test(NAME afe_quality_known_bad_fails
  COMMAND afe_quality_expect_fail $<TARGET_FILE:afe_quality_run> --known-bad
)