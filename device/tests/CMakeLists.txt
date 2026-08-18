# Tests (ADR-026 applied to the device world):
#   unit/        — L1 per-module tests (native build)
#   integration/ — composition-root test: core + AFE stages + one backend,
#                  wav in → trigger asserted (native harness, #182)
add_subdirectory(unit)
add_subdirectory(integration)
