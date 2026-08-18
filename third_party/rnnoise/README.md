# RNNoise — vendored noise suppression + VAD

- Upstream: https://gitlab.xiph.org/xiph/rnnoise (GitHub mirror: xiph/rnnoise)
- Version: **v0.1.1** (tag `v0.1.1`, commit `cdf196b1e9de2f8ff1003328ebf9a4316477429d`)
- License: BSD-3-Clause (`COPYING`)
- Import: pristine upstream tree (src/ + include/ + COPYING), **no patches**
  (ADR-037 Tier 1/2: upstream runs unchanged).
- Why v0.1.1: the classic stable release with **committed weights**
  (`rnn_data.c`) — no build-time table generation. This is the same lineage
  the browser WASM port (jitsi/timephy) comes from, so device behaviour
  mirrors the PWA demo (ADR-021).
- Library sources (from upstream `Makefile.am`): denoise.c, rnn.c, rnn_data.c,
  rnn_reader.c, pitch.c, kiss_fft.c, celt_lpc.c
- Public API: `rnnoise_create(model)`, `rnnoise_process_frame(st,out,in)`
  (returns VAD probability), `rnnoise_destroy(st)`,
  `rnnoise_model_from_file(f)` — see `include/rnnoise.h`.
- Consumed by: `packages/modules/afe/rnnoise/device/` (NS + VAD stage for the
  device-side SDK, ADR-021).
