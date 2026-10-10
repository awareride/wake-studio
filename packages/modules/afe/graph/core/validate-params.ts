/**
 * AFE module - spec-driven validation of runtime stage parameters (issue #243).
 *
 * A control that silently does nothing is worse than no control: the user tunes
 * a slider, sees no error, and concludes the DSP is at fault. So every value is
 * checked against the owning module's `module.spec.json` **before** it crosses
 * the worklet boundary — unknown keys and out-of-range values throw, they are
 * never dropped.
 *
 * The worklet itself stays permissive (stages ignore unknown keys and clamp),
 * because throwing inside an AudioWorklet callback would tear down the audio
 * thread. Validation lives here, on the main thread, where it can be reported.
 */

import type { ModuleParam, ModuleSpec } from '@wake-studio/contracts'
import aecSpec from '../../aec/spec/module.spec.json'
import bssSpec from '../../bss/spec/module.spec.json'
import rnnoiseSpec from '../../rnnoise/spec/module.spec.json'
import type { AFEStageKind, AFEStageParams } from './types'

/** Stage kind -> the module spec that owns its params. */
const SPECS: Record<AFEStageKind, ModuleSpec> = {
  aec: aecSpec as unknown as ModuleSpec,
  bss: bssSpec as unknown as ModuleSpec,
  ns: rnnoiseSpec as unknown as ModuleSpec,
}

export class AFEParamError extends Error {
  readonly stage: AFEStageKind
  readonly param: string

  constructor(stage: AFEStageKind, param: string, message: string) {
    super(`AFE ${stage}.${param}: ${message}`)
    this.name = 'AFEParamError'
    this.stage = stage
    this.param = param
  }
}

function paramOf(spec: ModuleSpec, id: string): ModuleParam | undefined {
  return (spec.params ?? []).find((p) => p.id === id)
}

function checkValue(stage: AFEStageKind, param: ModuleParam, value: unknown): void {
  switch (param.type) {
    case 'number':
    case 'slider': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new AFEParamError(stage, param.id, `expected a finite number, got ${JSON.stringify(value)}`)
      }
      if (param.min !== undefined && value < param.min) {
        throw new AFEParamError(stage, param.id, `value ${value} is below the minimum ${param.min}`)
      }
      if (param.max !== undefined && value > param.max) {
        throw new AFEParamError(stage, param.id, `value ${value} is above the maximum ${param.max}`)
      }
      return
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new AFEParamError(stage, param.id, `expected a boolean, got ${JSON.stringify(value)}`)
      }
      return
    }
    default: {
      // string / select / enum / multiselect and anything a spec adds later:
      // accept any scalar the worklet boundary can carry.
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new AFEParamError(
          stage,
          param.id,
          `only scalar values can cross the AudioWorklet boundary, got ${typeof value}`,
        )
      }
      return
    }
  }
}

/**
 * Validate a full parameter set for one stage against its spec.
 * Throws {@link AFEParamError} on the first problem.
 */
export function validateStageParams(kind: AFEStageKind, params: AFEStageParams): void {
  const spec = SPECS[kind]
  if (spec === undefined) {
    throw new AFEParamError(kind, '(stage)', `unknown AFE stage "${kind}"`)
  }
  for (const [id, value] of Object.entries(params)) {
    const param = paramOf(spec, id)
    if (param === undefined) {
      const known = (spec.params ?? []).map((p) => p.id).join(', ') || '(none)'
      throw new AFEParamError(kind, id, `not declared in ${spec.meta.id} module.spec.json (known: ${known})`)
    }
    checkValue(kind, param, value)
  }
}

/** Spec defaults for one stage, as a ready-to-send parameter set. */
export function defaultStageParams(kind: AFEStageKind): AFEStageParams {
  const spec = SPECS[kind]
  const out: AFEStageParams = {}
  for (const p of spec.params ?? []) {
    if (p.id === 'bypass') continue // delivered as a first-class config field
    if (typeof p.default === 'number' || typeof p.default === 'boolean' || typeof p.default === 'string') {
      out[p.id] = p.default
    }
  }
  return out
}