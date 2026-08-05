/**
 * Ambient declarations for Vite-specific module suffixes used across the KWS
 * modules (worker bundling).
 *
 * `?worker&url` and `?worker` are Vite-only import suffixes. When a driver
 * module type-checks the engine's core (which imports the worker via these
 * suffixes), the driver's TS program needs these declarations even though the
 * driver itself may not use Vite's client types directly. vite/client declares
 * them, but a driver that lacks the vite dep/ref would fail; declaring them
 * here keeps each module self-contained.
 */

declare module '*?worker' {
  const WorkerConstructor: new () => Worker
  export default WorkerConstructor
}

declare module '*?worker&url' {
  const url: string
  export default url
}
