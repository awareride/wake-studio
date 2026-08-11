/**
 * kws-streaming driver module - spec integrity (L1, ADR-026).
 *
 * The spec drives the panel generator, the module status table and the generic
 * train/build workflows, so a malformed spec must fail here, not in CI.
 */

import { describe, it, expect } from 'vitest'
import spec from '../spec/module.spec.json'

describe('kws-streaming module spec', () => {
  it('is a kws driver providing KWSBackend', () => {
    expect(spec.meta.id).toBe('kws-streaming')
    expect(spec.meta.category).toBe('kws')
    expect(spec.interfaces.provides).toContain('KWSBackend')
    expect(spec.interfaces.consumes).toContain('AFEOutputFrame')
  })

  it('credits the upstream Apache-2.0 license', () => {
    expect(spec.meta.license).toContain('Apache-2.0')
    expect(spec.meta.license).toContain('kws_streaming')
  })

  it('runs in the shared KWS worker (no DOM dependency, unlike sherpa)', () => {
    expect(spec.runtime.web.engine).toBe('KWSStreamingBackend')
    expect(spec.runtime.web.worker).toBe(true)
  })

  it('declares a dual-layer panel (ADR-024 §4)', () => {
    const groups = new Set(spec.params.map((p) => p.group))
    expect(groups).toContain('primary')
    expect(groups).toContain('advanced')
    const ids = spec.params.map((p) => p.id)
    expect(ids).toContain('wantedWord')
    expect(ids).toContain('threshold')
    expect(ids).toContain('resetOnTrigger')
  })

  it('offers WASM ONLY (the WebGPU/jsep EP mis-executes this graph)', () => {
    // Regression guard for the reported Squeeze failure: onnxruntime-web's jsep
    // EP ignores the `axes` input of the CLS-token Slice->Squeeze and throws
    // "Dimension of input 2 must be 1 instead of 64". Offering webgpu here
    // would advertise a setting the driver overrides anyway.
    const ep = spec.params.find((p) => p.id === 'executionProvider')
    expect(ep?.default).toBe('wasm')
    expect(ep?.options).toEqual(['wasm'])
  })

  it('defaults resetOnTrigger to false (upstream reset0, the reported setting)', () => {
    const reset = spec.params.find((p) => p.id === 'resetOnTrigger')
    expect(reset?.default).toBe(false)
  })

  it('wires the UNPATCHED upstream train script (ADR-031)', () => {
    expect(spec.train.script.repo).toBe('https://github.com/google-research/google-research')
    expect(spec.train.script.path).toBe('kws_streaming/train/model_train_eval.py')
    expect(spec.train.script.language).toBe('python')
    // ADR-031: adapt to upstream output, never rewrite it.
    expect(spec.train.adapter).toBe('standardize-results')
    // The external-state TFLite artifact is what the driver converts + runs.
    expect(spec.train.outputs.checkpoint).toContain('stream_state_external')
  })

  it('declares the module-owned build script + python toolchain', () => {
    expect(spec.build.recipe).toBe('workflow')
    expect(spec.build.workflowRef).toBe('.github/workflows/build.yaml')
    expect(spec.build.script).toBe('scripts/build-kws-streaming.mjs')
    expect(spec.build.toolchains.python).toBeTruthy()
  })

  it('defaults to the ARM keyword-transformer pretrained checkpoints', () => {
    const ids = spec.build.inputs.map((i) => i.id)
    for (const id of ['checkpoint_repo', 'checkpoint_ref', 'checkpoint_root', 'checkpoints', 'opset', 'hop_ms']) {
      expect(ids).toContain(id)
    }
    const repo = spec.build.inputs.find((i) => i.id === 'checkpoint_repo')
    expect(repo?.default).toContain('ARM-software/keyword-transformer')
    const root = spec.build.inputs.find((i) => i.id === 'checkpoint_root')
    expect(root?.default).toBe('models_data_v2_12_labels')
    const ckpts = spec.build.inputs.find((i) => i.id === 'checkpoints')
    expect(ckpts?.default).toContain('kwt1')
  })

  it('unpacks the artifact into a dedicated assets subdir', () => {
    expect(spec.build.fetch?.subdir).toBe('kws-streaming')
    expect(spec.build.artifactName).toBe('kws-streaming-onnx')
    expect(spec.build.registryEntry).toContain('model-registry.json')
  })

  it('requires all three test layers (pretrained artifact exists, ADR-026)', () => {
    expect(spec.tests.required).toEqual(['l1', 'l2', 'l3'])
    expect(spec.tests.l2).toContain('onnx-runtime.test.ts')
    // L3 must be the INFERENCE spec, not a load-only one: a load-only test
    // passed while every run() threw (the jsep Squeeze bug).
    expect(spec.tests.l3).toContain('e2e/kws-streaming-inference.spec.ts')
  })

  it('offers the 12-label wake words, excluding the non-word labels', () => {
    const wanted = spec.params.find((p) => p.id === 'wantedWord')
    expect(wanted?.type).toBe('select')
    expect(wanted?.options).toContain('yes')
    expect(wanted?.options).toContain('stop')
    // _silence_ / _unknown_ are classifier outputs, never wake words.
    expect(wanted?.options).not.toContain('_silence_')
    expect(wanted?.options).not.toContain('_unknown_')
  })
})
