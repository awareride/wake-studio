/**
 * AFE graph - spec geometry vs engine geometry (issue #245).
 *
 * A stage's geometry now exists in three places by design: the device ops
 * struct (C), the browser stage engine (`AFEStage.geometry`), and the module
 * spec (`spec.afe.geometry`). The claim that makes that duplication acceptable
 * is that a test catches drift between the two JS places, so this is it: every
 * AFE stage module's spec declaration must equal what its engine actually
 * declares at runtime.
 *
 * The device side is C and cannot be imported here; its correspondence is
 * asserted by the geometry comments in each `device/src/*_stage.c` ops struct
 * and by the device graph's own per-frame validation.
 */

import { describe, it, expect } from 'vitest'
import type { AFEStage, AFEStageKind, ModuleSpec } from '@wake-studio/contracts'
import { AecStage } from '@wake-studio/module-afe-aec'
import { BssStage } from '@wake-studio/module-afe-bss'
import { loadRnnoiseStage } from '@wake-studio/module-rnnoise/web/loader'
import aecSpec from '../../aec/spec/module.spec.json'
import bssSpec from '../../bss/spec/module.spec.json'
import rnnoiseSpec from '../../rnnoise/spec/module.spec.json'

const STAGES: Array<{ kind: AFEStageKind; spec: ModuleSpec; stage: AFEStage | null }> = [
  { kind: 'aec', spec: aecSpec as unknown as ModuleSpec, stage: new AecStage() },
  { kind: 'bss', spec: bssSpec as unknown as ModuleSpec, stage: new BssStage() },
  { kind: 'ns', spec: rnnoiseSpec as unknown as ModuleSpec, stage: null },
]

describe('AFE stage geometry: spec declares what the engine declares', () => {
  for (const { kind, spec, stage } of STAGES) {
    it(`${kind}: spec declares an afe block for its own stage id`, () => {
      expect(spec.afe, `${spec.meta.id} module.spec.json has no afe block`).toBeDefined()
      expect(spec.afe!.stageId).toBe(kind)
    })

    if (stage) {
      it(`${kind}: engine geometry matches the spec`, () => {
        expect(stage.geometry).toEqual(spec.afe!.geometry)
      })
    }
  }

  it('ns: the RNNoise stage engine declares the same geometry as its spec', () => {
    // The vendored RNNoise WASM is embedded as base64, so the stage loads in
    // node: the geometry check can be real instead of assumed.
    const stage = loadRnnoiseStage() as AFEStage
    expect(stage.geometry).toEqual(rnnoiseSpec.afe!.geometry)
  })
})
