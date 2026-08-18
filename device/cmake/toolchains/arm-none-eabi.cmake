# ARM Cortex-M cross toolchain (issue #186) — compile/link only, no board.
#
# The mcu profile + this toolchain must build every library target. Executables
# (tests, CLI demo) are host-only and are gated in the top-level CMakeLists by
# CMAKE_CROSSCOMPILING.
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

set(CMAKE_C_COMPILER arm-none-eabi-gcc)
set(CMAKE_CXX_COMPILER arm-none-eabi-g++)
set(CMAKE_ASM_COMPILER arm-none-eabi-gcc)

# There is no OS/libc to link against; compile-only verification (static libs).
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# Cortex-M4 (STM32F4 family) baseline; the golden-path board lands later.
# NOTE: no -ffreestanding here — it hides malloc/calloc/free in newlib's
# stdlib.h (freestanding subset), which the core uses for its allocator seam.
set(CMAKE_C_FLAGS_INIT "-mcpu=cortex-m4 -mthumb")
set(CMAKE_CXX_FLAGS_INIT "-mcpu=cortex-m4 -mthumb")
