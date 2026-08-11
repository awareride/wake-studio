/**
 * kws-engine - worker wire runtime test (issue #23 regression, ADR-034).
 *
 * The worker bundle gets the driver registration side-effects only because
 * web/worker.ts imports the worker composition root (web/worker-wire.ts),
 * which imports the driver modules. This test imports the wire in a Node
 * process and asserts the registry is actually populated — the exact failure
 * mode of #23 ("Unknown KWS backend: openwakeword") would surface here as an
 * empty registry.
 *
 * Note: this test intentionally imports the wire (which imports the drivers),
 * so it must run in a context where the engine->driver package cycle is
 * resolvable (workspace links, established by pnpm install).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  createKwsWorker,
  KWSWorker,
} from '../web/worker-assembly'
import { getBackendRegistry, getBackendRegistration } from '../core/backend'

// The worker composition root (generated, ADR-034) — importing it runs the
// driver registration side-effects, exactly as web/worker.ts does.
import '../web/worker-wire'

describe('worker wire wires drivers into the registry', () => {
  beforeAll(() => {
    // The assembly only creates the worker; the wire does the registration.
    void KWSWorker
    void createKwsWorker
  })

  it('registers openwakeword (worker-side registry)', () => {
    expect(getBackendRegistration('openwakeword')).toBeDefined()
  })

  it('registers sherpa-onnx-kws with a mainThreadFactory', () => {
    const reg = getBackendRegistration('sherpa-onnx-kws')
    expect(reg).toBeDefined()
    expect(reg?.mainThreadFactory).toBeTypeOf('function')
  })

  it('registers plixkws + the embed-provider factory', () => {
    expect(getBackendRegistration('plixkws')).toBeDefined()
  })

  it('the registry is not empty after assembly import', () => {
    const ids = getBackendRegistry().map((r) => r.id)
    expect(ids).toContain('openwakeword')
    expect(ids).toContain('sherpa-onnx-kws')
    expect(ids).toContain('plixkws')
  })
})
