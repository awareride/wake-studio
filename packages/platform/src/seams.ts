/**
 * Runtime-agnostic seams the platform exposes (ADR-025 platform layer).
 *
 * These are *contracts* modules depend on - the concrete browser
 * implementations live behind `@wake-studio/platform/web` (or are injected by
 * the app). Kept minimal per the YAGNI scope guard: a seam lands here only
 * when it has (or will have) ≥2 consumers.
 */

/** A module's compiled/binary asset (wasm, onnx, ...) loaded on demand. */
export interface WasmLoader {
  /**
   * Load a binary asset and return a handle the module can use (e.g. an
   * emscripten Module object or an onnxruntime session factory).
   */
  load(src: string): Promise<unknown>
}

/** Browser audio-capture seam (concrete impl in `./web`). */
export interface AudioSource {
  start(): Promise<void>
  stop(): void
  /** Optional downstream audio graph node wiring. */
  connect?(target: unknown): void
}
