/**
 * kws-plix driver module - L1 tests (ADR-026).
 * Guards the build-block spec that drives the generic build workflow.
 */

import { describe, it, expect } from 'vitest'
import spec from '../spec/module.spec.json'

describe('kws-plix module spec', () => {
  it('declares the workflow build script', () => {
    expect(spec.build.recipe).toBe('workflow')
    expect(spec.build.workflowRef).toBe('.github/workflows/build.yaml')
    expect(spec.build.script).toBe('scripts/build-plix.mjs')
  })

  it('declares python toolchain + build inputs', () => {
    expect(spec.build.toolchains.python).toBe('3.11')
    const ids = spec.build.inputs.map((i) => i.id)
    expect(ids).toContain('encoder')
    expect(ids).toContain('language')
    expect(ids).toContain('opset')
  })

  it('declares the artifact + registry entry', () => {
    expect(spec.build.artifactName).toBe('plixkws-onnx')
    expect(spec.build.registryEntry).toContain('model-registry.json')
  })

  it('is a kws driver module providing EmbedProvider', () => {
    expect(spec.meta.category).toBe('kws')
    expect(spec.interfaces.provides).toContain('EmbedProvider')
  })
})
