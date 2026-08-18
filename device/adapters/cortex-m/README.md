# Cortex-M adapter (STM32/Arduino) — golden-path MCU tier (ADR-019)

## Current state (skeleton)

The CMake target `wake_adapters_cortex_m` exists and the cross-compile CI job
validates that the core + modules build and link for `arm-none-eabi`
(`-mcpu=cortex-m4 -mthumb`, mcu profile). No sources yet.

## Next step (on-hardware milestone, #38)

1. **Capture**: I2S/PDM microphone DMA → 16 kHz PCM16 frames (one cheap
   STM32 Nucleo or Arduino Nano 33 BLE board, ~$20–40).
2. **Output**: trigger callback → GPIO/LED (and/or serial log).
3. Wire the microwakeword driver (TFLite-Micro runtime) as the backend and
   validate "triggers on the wake word" on real hardware (golden-path
   acceptance).
