# Cortex-M adapter skeleton (issue #186).
#
# Golden-path target (ADR-019: STM32/Arduino, micro-wake-word + TFLite-Micro).
# Capture + output stubs land with the on-hardware validation milestone
# (#38): the cross-compile CI job (arm-none-eabi, mcu profile) validates the
# libraries; the board brings the real audio I/O.
add_library(wake_adapters_cortex_m INTERFACE)
target_include_directories(wake_adapters_cortex_m INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)
