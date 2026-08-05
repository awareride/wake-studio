/**
 * kws-sherpa driver module - L1 tests (ADR-026).
 * The build-block spec drives the generic build workflow; these tests guard
 * the spec's integrity (params, inputs, toolchains) so a malformed spec
 * fails fast locally, not in CI.
 */

import { describe, it, expect } from 'vitest'
import spec from '../spec/module.spec.json'

describe('kws-sherpa module spec', () => {
  it('declares the workflow build script', () => {
    expect(spec.build.recipe).toBe('workflow')
    expect(spec.build.workflowRef).toBe('.github/workflows/build.yaml')
    expect(spec.build.script).toBe('scripts/build-sherpa-kws.mjs')
  })

  it('declares emsdk toolchain + build inputs', () => {
    expect(spec.build.toolchains.emsdk).toBeTruthy()
    const ids = spec.build.inputs.map((i) => i.id)
    expect(ids).toContain('sherpa_version')
    expect(ids).toContain('emsdk_version')
    expect(ids).toContain('kws_model')
  })

  it('declares the artifact + registry entry', () => {
    expect(spec.build.artifactName).toBe('sherpa-onnx-kws-wasm')
    expect(spec.build.registryEntry).toContain('model-registry.json')
  })

  it('is a kws driver module with KWSBackend interface', () => {
    expect(spec.meta.category).toBe('kws')
    expect(spec.interfaces.provides).toContain('KWSBackend')
  })
})
