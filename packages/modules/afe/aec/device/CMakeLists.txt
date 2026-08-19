# AEC module — device target (ADR-021/040 §2, passthrough v1 per ADR-016).
add_library(wake_afe_aec STATIC src/aec_stage.c)
target_link_libraries(wake_afe_aec PUBLIC wake_sdk_core)
