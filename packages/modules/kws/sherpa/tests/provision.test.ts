/**
 * kws-sherpa provisioning capability tests (ADR-033).
 *
 * sherpa-onnx-kws provisions the wake-word artifact it loads with: a keyword
 * list. produce() validates/normalizes the keyword text; apply() maps it into
 * the engine load backend config (the shape the main-thread backend's
 * configure() consumes).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { getBackendRegistration } from '@wake-studio/module-kws-engine'
import '@wake-studio/module-kws-sherpa'

type SherpaProvision = NonNullable<
  NonNullable<ReturnType<typeof getBackendRegistration>>['provision']
>

describe('sherpa-onnx-kws provisioning capability (ADR-033)', () => {
  let provision: SherpaProvision

  beforeEach(() => {
    const reg = getBackendRegistration('sherpa-onnx-kws')
    expect(reg?.provision).toBeDefined()
    provision = reg!.provision!
  })

  it('declares kind list with a provisioning spec', () => {
    expect(provision.kind).toBe('list')
    const actionIds = provision.spec?.actions.map((a) => a.id) ?? []
    expect(actionIds).toContain('load-with-list')
  })

  it('produce() wraps the keyword text into a list artifact', async () => {
    const text = 'n \u01d0 h \u01ceo @hello\nx i\u01ceo \u00e0i @xiaoyi'
    const artifact = await provision.produce({ keywords: text })
    expect(artifact.kind).toBe('list')
    expect(artifact.backendId).toBe('sherpa-onnx-kws')
    if (artifact.kind !== 'list') return
    expect(artifact.payload.keywords).toBe(text)
  })

  it('produce() rejects an empty keyword list', async () => {
    await expect(provision.produce({ keywords: '   ' })).rejects.toThrow(
      'keyword list is empty',
    )
  })

  it('apply() maps the list artifact into backendConfig.keywords', async () => {
    const artifact = await provision.produce({ keywords: 'n \u01d0 h \u01ceo @hello' })
    const applied = provision.apply(artifact)
    expect(applied.urls).toBeUndefined()
    expect(applied.backendConfig?.keywords).toBe('n \u01d0 h \u01ceo @hello')
  })

  it('apply() rejects a non-list artifact', () => {
    expect(() =>
      provision.apply({
        kind: 'prototype',
        backendId: 'sherpa-onnx-kws',
        payload: {
          id: 'p',
          word: 'x',
          vector: [1],
          sampleIds: [],
          createdAtMs: Date.now(),
        },
      }),
    ).toThrow('only consumes keyword-list artifacts')
  })
})
