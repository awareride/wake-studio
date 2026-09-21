# Composition roots (ADR-040 §3) — the only place modules are registered.
#
#   host_root.c — reference root for the host (macOS/Linux) build; the CLI
#                 demo and integration tests compose through it. The bundle
#                 generator (#189) emits per-target roots from module specs.
add_library(wake_composition_host STATIC host_root.c)
target_link_libraries(wake_composition_host PUBLIC
  wake_sdk_core
  wake_afe_rnnoise
  wake_afe_aec
  wake_afe_bss
  wake_adapters_host
  # App-class KWS drivers (#187 slice A: plix/openwakeword/streaming/sherpa).
  # Each driver is runtime-gated: without its -DHAS_RUNTIME=ON build it still
  # compiles and registers, but load() fails loudly and process_frame() stays
  # in warmup — so the host build needs no third_party fetches.
  wake_kws_plix
  wake_kws_openwakeword
  wake_kws_streaming
  wake_kws_sherpa
)
