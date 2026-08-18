# Target adapters (ADR-021 §2): per-platform implementations of the
# abstractions (audio capture, model runtime, threading/clock).
#
#   host/     — reference adapter: wav-file input (harness + CLI demo, #182)
#   cortex-m/ — STM32/Arduino skeleton (cross-compile stage, #186)
#
# Adapters are added here as they land; an empty tree is a valid build.
