/**
 * platform package - shared WakeStudio capability layer (ADR-025).
 *
 * Modules depend on this package for base-path resolution, the lazy model
 * registry, and runtime seams - never on apps/web internals. apps/web
 * focuses on product interaction, not capability (Q-P1).
 */

export { APP_BASE, resolveAsset } from './base-path'
export {
  loadRegistry,
  isCommerciallyUsable,
  type ModelRegistry,
  type RegistryModel,
  type ModelTier,
  type ModelClass,
} from './registry'
export { probeModelUrl, type ProbeResult } from './probe'
export {
  DEFAULT_MODEL_RUNTIME,
  RUNTIME_LABELS,
  type ModelRuntime,
} from './runtime'
export type { WasmLoader, AudioSource } from './seams'
