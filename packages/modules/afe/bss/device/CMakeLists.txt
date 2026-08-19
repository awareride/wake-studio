# BSS module — device target (ADR-021/040 §2, passthrough v1 per ADR-016).
add_library(wake_afe_bss STATIC src/bss_stage.c)
target_link_libraries(wake_afe_bss PUBLIC wake_sdk_core)
