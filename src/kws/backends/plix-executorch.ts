/**
 * PLiX encoder runtime: ExecuTorch WASM (DEFERRED implementation).
 *
 * This file mirrors the shape of the Transformers.js runtime
 * (`plix-transformers.ts`): it implements the `PlixEncoder` interface and is
 * selected via `runtime: "executorch"` in the model URLs / engine config. The
 * actual ExecuTorch WASM integration is intentionally DEFERRED - the model is
 * "loaded" (the WASM runtime + a `.pte` program located) but `embed()` is not
 * yet wired to a real ExecuTorch `Module.forward` call. It currently throws a
 * clear, actionable error so the runtime is selectable end-to-end without
 * shipping a half-working inference path.
 *
 * Why ExecuTorch: it is PyTorch's official on-device runtime, compilable to
 * WebAssembly (wasm-simd) and WebGPU, and is the natural "native" runtime slot
 * for the heaviest on-device / in-browser targets (the native runtime slot that
 * was previously sketched as a generic 'libtorch' runtime). The PLiX `.pt` weights must first be exported to an ExecuTorch
 * `.pte` program (a Python step alongside the ONNX export) before this runtime
 * can run them.
 *
 * Pending (real implementation, follow-up):
 *   1. Add the ExecuTorch WASM dependency (npm `executorch` / official
 *      `extension/wasm` build) - requires install authorization (AGENTS.md).
 *   2. Build a `Module` from the `.pte` bytes, call `forward()` with the
 *      1x64x100 log-Mel `Tensor`, and read back the 1280-d embedding.
 *   3. Add the `.pte` export to scripts/export-plixkws-onnx.py.
 *
 * Like the other runtimes, the acoustic front-end is computed here in JS
 * (`plix-frontend.logMelSpectrogram`) so ExecuTorch receives the same
 * 1x64x100 log-Mel image as the ONNX graph - producing an identical embedding.
 *
 * @see src/runtime.ts (ModelRuntime = 'onnx' | 'transformers' | 'executorch')
 * @see docs/Technical Reference_ Resource Requirements and Zero-Python
 *      Deployment Strategies for WavLM-base-plus and plixkws.md §3.2
 */

import type { PlixEncoder } from './plix-encoder'
import {
  PLIX_SAMPLE_RATE,
  PLIX_N_MELS,
  PLIX_TARGET_FRAMES,
  PLIX_WINDOW_LENGTH,
  PLIX_HOP_LENGTH,
  melSpectrogram,
  fitFrames,
} from './plix-frontend'
export class PlixExecuTorchEncoder implements PlixEncoder {
  readonly runtime = 'executorch' as const
  private _modelId: string

  constructor(modelId: string) {
    this._modelId = modelId
  }

  get ready(): boolean {
    // DEFERRED: no Module is constructed yet, so the encoder is never "ready"
    // for inference. load() still validates the .pte locator so wiring is real.
    return false
  }

  async load(locator: string): Promise<void> {
    // Dynamic import: the ExecuTorch WASM dependency is only fetched when this
    // runtime is actually selected. The specifier is held in a variable so the
    // bundler does NOT statically resolve it before the dep is installed.
    // Once wired, this resolves to e.g. `executorch` (npm) or the official
    // `extension/wasm` build.
    const spec = 'executorch' // TODO(real impl): pin the chosen ExecuTorch WASM build
    // @vite-ignore: 'executorch' is an OPTIONAL dependency declared external in
    // vite.config.ts. It is only resolved at runtime when this (deferred)
    // runtime is selected, so Vite must not statically analyze the import.
    await import(/* @vite-ignore */ spec) // retained so the optional dep is dynamically referenced

    // Fetch the `.pte` program bytes (located by the model id) to validate the
    // locator now. The real runtime loads them into an ExecuTorch `Module`.
    const modelUrl = this._modelId || locator
    const response = await fetch(modelUrl)
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ExecuTorch model ${modelUrl}: ${response.status} ${response.statusText}`,
      )
    }
    await response.arrayBuffer() // validated; bytes unused until impl lands
  }

  async embed(audio: Float32Array, sampleRate: number): Promise<Float32Array> {
    if (sampleRate !== PLIX_SAMPLE_RATE) {
      throw new Error(
        `PLiX encoder expects ${PLIX_SAMPLE_RATE} Hz audio; got ${sampleRate} Hz.`,
      )
    }
    // Build the shared 1x64x100 raw-mel front-end (same as the ONNX runtime) so
    // that, once wired, ExecuTorch consumes an identical input image. The graph
    // applies the log itself, so this is raw mel magnitude.
    const mel = melSpectrogram(audio)
    const numFrames = Math.floor(
      (audio.length - PLIX_WINDOW_LENGTH) / PLIX_HOP_LENGTH + 1,
    )
    const spectrogram = fitFrames(mel, numFrames)
    if (spectrogram.length !== PLIX_N_MELS * PLIX_TARGET_FRAMES) {
      throw new Error(
        `PLiX (executorch) front-end produced ${spectrogram.length} values; ` +
          `expected ${PLIX_N_MELS * PLIX_TARGET_FRAMES} (1x${PLIX_N_MELS}x${PLIX_TARGET_FRAMES}).`,
      )
    }

    // DEFERRED: the real call will be roughly:
    //   const sdk = (await import('executorch')) as unknown as ExecuTorchSdk
    //   const input = new sdk.Tensor(mel, { shape: [1, 1, N_MELS, TARGET_FRAMES] })
    //   const module = new sdk.Module(modelBytes)
    //   await module.load()
    //   const out = await module.forward(input)
    //   return out.toTypedArray() // 1280-d
    throw new Error(
      'PLiX (executorch) runtime is deferred: ExecuTorch WASM inference is not ' +
        'yet implemented. The front-end is computed but no Module.forward call ' +
        'is wired. Select runtime "onnx" or "transformers" for a working path.',
    )
  }

  async dispose(): Promise<void> {
    // Nothing to release in the deferred implementation.
  }
}
