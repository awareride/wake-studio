/**
 * Trainable-modules catalog (issue #105).
 *
 * Runtime-loaded from `train-modules.json` (generated from the module specs
 * by scripts/build-model-registry.mjs — ADR-025 single source of truth,
 * ADR-034-safe: no driver imports). The training console uses it to list
 * model types and to render each module's train config + invocation methods.
 */

import { resolveAsset } from '@wake-studio/platform'
import type { ModuleParam } from '@wake-studio/contracts'

/** The subset of spec.train the console renders (mirrors the schema). */
export interface TrainableModuleTrain {
  entry?: string
  deps?: string
  notebookLocal?: string
  /** The module's own train params (spec.train.params, issue #105). */
  params?: ModuleParam[]
  notebook?: { repo: string; path: string; ref: string; paramsCell?: number }
  script?: {
    repo: string
    path: string
    ref: string
    entrypoint?: string
    language?: string
  }
  python?: string
  invocation?: string[]
  outputs?: { checkpoint?: string; metrics?: string }
  /** ADR-039 §4.5: multi-wake-word capability. */
  multiWord?: boolean
  /** ADR-039 §4.6: selectable output formats. */
  formats?: { default: string[]; options: string[] }
  /** ADR-039 §4.6: selectable quantization schemes. */
  quantization?: { default?: string; options: string[] }
  /** ADR-039 §4.6: module-owned convert script declaration. */
  convert?: { entry: string; from?: string[]; to?: string[] }
}

export interface TrainableModule {
  id: string
  category: string
  name: string
  license: string
  maturity: string
  train: TrainableModuleTrain
}

let cache: TrainableModule[] | null = null

/** Fetch the catalog once and cache it for the session. */
export async function fetchTrainableModules(): Promise<TrainableModule[]> {
  if (cache) return cache
  const res = await fetch(resolveAsset('train-modules.json'))
  if (!res.ok) {
    throw new Error(
      `Could not load the trainable-modules catalog (HTTP ${res.status}).`,
    )
  }
  const data = (await res.json()) as { modules: TrainableModule[] }
  cache = data.modules
  return cache
}

export function findTrainableModule(
  modules: TrainableModule[],
  id: string | undefined,
): TrainableModule | undefined {
  return modules.find((m) => m.id === id)
}