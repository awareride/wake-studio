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

# AEC evaluation harness (issue #249, slice A)
#
# Same shape as the NS harness above: a production gate that must PASS, and a
# known-bad negative control that must FAIL. The control matters more here than
# the gate -- the corpus far end is broadband precisely so that ERLE can tell a
# correctly-aligned AEC (15 dB) from a misaligned one (0.5 dB). On a periodic
# far end both scored ~15 dB and the control proved nothing.
#
# aec_ref.cxx is the conforming reference NLMS over the wake/aec.h ABI. It lives
# in the test tree, not in wake_sdk_core: the ABI is the deliverable, the filter
# is the example that pins it down (issue #249 is an evaluation spike, not a
# shipped AEC -- ADR-048 §4 leaves the MCU AEC unresolved).
add_executable(aec_quality_run
  corpus.cxx
  aec_metrics.cxx
  aec_ref.cxx
  run_aec.cxx
)
target_link_libraries(aec_quality_run PRIVATE wake_sdk_core)
target_include_directories(aec_quality_run
  PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}
)

add_test(NAME aec_quality COMMAND aec_quality_run)

add_executable(aec_quality_expect_fail
  expect_fail.cxx
)
add_dependencies(aec_quality_expect_fail aec_quality_run)
add_test(NAME aec_quality_known_bad_fails
  COMMAND aec_quality_expect_fail $<TARGET_FILE:aec_quality_run> --known-bad
)