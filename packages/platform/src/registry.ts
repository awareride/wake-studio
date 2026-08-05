/**
 * Typed loader for the lazily-fetched model registry (ADR-011).
 *
 * The registry JSON lives at `/public/model-registry.json` (served at the
 * deploy base) and is fetched at runtime - models are never bundled with the
 * PWA. Moved verbatim from `apps/web/src/data/registry.ts`
 * (module-migration §6.1).
 */

import { resolveAsset } from './base-path'

export type ModelTier = 'low-power' | 'high-performance'
export type ModelClass = 'redistributable' | 'demo-only'

export interface RegistryModel {
  id: string
  name: string
  tier: ModelTier[]
  source: string
  url: string
  format: string
  license: string
  commercial: boolean
  class: ModelClass
  sha256: string | null
  sizeBytes: number | null
  /** PLiX encoder variant ('base' | 'small') when format === 'onnx'. */
  encoderVariant?: 'base' | 'small'
  /** Hugging Face repo id for the transformers runtime. */
  transformersModel?: string
  /** Embedding dimensionality (PLiX = 1280 for all variants). */
  embeddingDim?: number
  /** For ONNX external-data exports: the co-located .data file name. */
  externalData?: string
  notes?: string
}

export interface ModelRegistry {
  version: number
  updated: string
  note?: string
  models: RegistryModel[]
}

const REGISTRY_URL = 'model-registry.json'

export async function loadRegistry(
  signal?: AbortSignal,
): Promise<ModelRegistry> {
  const res = await fetch(resolveAsset(REGISTRY_URL), { signal })
  if (!res.ok) {
    throw new Error(`Failed to load model registry: HTTP ${res.status}`)
  }
  return (await res.json()) as ModelRegistry
}

/**
 * The Phase 4 export license gate uses this. A model is commercially usable
 * only if it is both redistributable and explicitly commercial.
 */
export function isCommerciallyUsable(model: RegistryModel): boolean {
  return model.commercial && model.class === 'redistributable'
}
