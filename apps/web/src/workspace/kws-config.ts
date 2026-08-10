/**
 * KWS config helpers (epic #53 P7, plan §8.3).
 *
 * Shared source of truth for the KWS configuration surface — used by the KWS
 * panel (Step C of the workspace) so the kept panel and the step layout
 * never drift: driver params come from the backend registration spec
 * (ADR-025), model candidates from the platform model registry (ADR-011/027).
 */

import { getBackendRegistry } from '@wake-studio/module-kws-engine'
import type { BackendModelUrls } from '@wake-studio/module-kws-engine'
import type { ParameterDescriptor } from '@wake-studio/module-afe-graph'
import type { ModelRegistry } from '@wake-studio/platform'
import type { ModuleSpec, ModuleParam } from '@wake-studio/contracts'

/** Build a ParameterDescriptor from a ModuleSpec param (spec -> panel).
 *  ModuleParam.type has extra kinds (enum/secret/slider); map to the panel's
 *  ParameterDescriptor union (number/boolean/select/string). */
function descriptorFromParam(param: ModuleParam): ParameterDescriptor {
  const type: ParameterDescriptor['type'] =
    param.type === 'slider'
      ? 'number'
      : param.type === 'enum'
        ? 'select'
        : param.type === 'secret'
          ? 'string'
          : param.type
  return {
    id: param.id,
    label: param.label,
    type,
    default: param.default,
    min: param.min,
    max: param.max,
    step: param.step,
    unit: param.unit,
    description: param.description,
    options: param.options as ParameterDescriptor['options'],
  }
}

/** The selected backend's own tunable params, from its registration spec
 *  (ADR-025) - empty when the backend carries no spec. */
export function driverParamsFor(backendId: string): ReadonlyArray<ParameterDescriptor> {
  const reg = getBackendRegistry().find((r) => r.id === backendId)
  const spec = reg?.spec as ModuleSpec | undefined
  return (spec?.params ?? []).map(descriptorFromParam)
}

/** Resolve the three openwakeword model roles from a registry, or a remote
 *  assets path (ADR-025) for local models, remote for the classifier. */
export function modelUrlsFromRegistry(registry: ModelRegistry): BackendModelUrls {
  const byId = new Map(registry.models.map((m) => [m.id, m.url]))
  return {
    melspectrogram: byId.get('melspectrogram'),
    embedding: byId.get('speech_embedding'),
    classifier: byId.get('hey-buddy'),
  }
}

/**
 * A selectable model source for one KWS model role: a registry entry (the
 * built-in pretrained model) or a user-supplied URL (e.g. a model trained
 * with this platform, or a custom artifact URL).
 */
export interface ModelSourceOption {
  /** Registry id, or 'custom' for a user-supplied URL. */
  id: string
  /** Label shown in the selector. */
  label: string
  /** Resolved URL (undefined only for the 'custom' placeholder). */
  url?: string
  /** License / commercial note (from the registry) for the built-ins. */
  note?: string
}

/**
 * Build the candidate model sources for one KWS model role.
 *
 * @param registry the loaded model registry
 * @param role     which model the backend needs:
 *   - 'melspectrogram'  openwakeword log-Mel front-end
 *   - 'embedding'       openwakeword speech-embedding backbone
 *   - 'classifier'      openwakeword wake-word classifier (any classifier
 *                       onnx that consumes the 96-dim embedding)
 *   - 'plix-encoder'    PLiX few-shot encoder (base / small variants)
 * @param current  the currently selected URL (to mark it selected)
 */
export function modelSourcesForRole(
  registry: ModelRegistry,
  role: 'melspectrogram' | 'embedding' | 'classifier' | 'plix-encoder' | 'kws-streaming-model',
  current?: string,
): ModelSourceOption[] {
  const builtIns = registry.models
    .filter((m) => {
      switch (role) {
        case 'melspectrogram':
          return m.id === 'melspectrogram'
        case 'embedding':
          return m.id === 'speech_embedding'
        case 'classifier':
          // Any classifier the openwakeword pipeline can consume: the
          // hey-buddy model (commercially clean) plus the openwakeword demo
          // classifiers (CC BY-NC-SA, demo-only, flagged in the option note).
          return (
            m.id === 'hey-buddy' ||
            m.id === 'buddy' ||
            m.id.startsWith('openwakeword-') ||
            /^(hey|hi|yo|sup|okay|hello|alexa|timer|weather)_?/i.test(m.id) ||
            /classifier/i.test(m.id)
          )
        case 'plix-encoder':
          return m.id === 'plixkws' || m.id === 'plixkws-small'
        case 'kws-streaming-model':
          // Exported kws_streaming-family graphs; each carries a sidecar
          // manifest (manifestUrl) describing its geometry.
          return m.id.startsWith('kws-streaming-')
      }
    })
    .map((m) => ({
      id: m.id,
      label: `${m.name} (${m.id})`,
      url: m.url,
      note:
        `${m.license} · ${m.commercial ? 'commercial' : 'non-commercial'} · ` +
        `${m.sizeBytes ? (m.sizeBytes / 1024 / 1024).toFixed(1) + ' MB' : 'size n/a'}` +
        `${m.accuracy ? ` · ${m.accuracy}% top-1` : ''}`,
    }))

  // Custom-URL option: use the current URL as its value when one is set and
  // does not match a built-in (i.e. the user previously chose a custom URL).
  const custom: ModelSourceOption = {
    id: 'custom',
    label: 'Custom URL…',
    url: current && !builtIns.some((b) => b.url === current) ? current : undefined,
    note: 'Provide your own model URL (e.g. a model trained with this platform).',
  }

  return [...builtIns, custom]
}

/** One model role the Model-source editor offers for a backend. */
export interface ModelSourceRole {
  role: 'melspectrogram' | 'embedding' | 'classifier' | 'plix-encoder' | 'kws-streaming-model'
  label: string
  fallbackId: string
}

/** Model roles for the traditional (openwakeword) backend. */
export const TRADITIONAL_MODEL_ROLES: ModelSourceRole[] = [
  { role: 'melspectrogram', label: 'Mel front-end', fallbackId: 'melspectrogram' },
  { role: 'embedding', label: 'Embedding backbone', fallbackId: 'speech_embedding' },
  { role: 'classifier', label: 'Wake-word classifier', fallbackId: 'hey-buddy' },
]

/** Model roles for the few-shot (plixkws) backend. */
export const FEWSHOT_MODEL_ROLES: ModelSourceRole[] = [
  { role: 'plix-encoder', label: 'PLiX encoder', fallbackId: 'plixkws' },
]

/**
 * Model roles for the kws-streaming backend (ADR-024 Traditional).
 *
 * One role: the exported graph. Its sidecar manifest travels with it via the
 * registry's `manifestUrl`, so the user picks a model, not a pair of files.
 */
export const KWS_STREAMING_MODEL_ROLES: ModelSourceRole[] = [
  {
    role: 'kws-streaming-model',
    label: 'kws_streaming model',
    fallbackId: 'kws-streaming-kwt1',
  },
]
