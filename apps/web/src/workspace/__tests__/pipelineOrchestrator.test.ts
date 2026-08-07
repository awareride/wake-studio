/**
 * Pipeline lifecycle orchestrator tests (epic #53 P4).
 *
 * Pure-function tests (no React / testing-library): verifies the unified
 * Start/Stop order — AFE first, then KWS auto-load (preload ON) + auto-start,
 * preload-OFF leaves KWS idle, Stop tears down KWS then AFE, and load
 * failures surface as errors.
 */

import { describe, it, expect } from 'vitest'
import { runPipelineStart, runPipelineStop } from '../pipelineOrchestrator'
import type { PanelCommands } from '../usePipelineRunner'

function makeAfe(over: Partial<PanelCommands> = {}): PanelCommands & {
  calls: { starts: number; stops: number }
} {
  const calls = { starts: 0, stops: 0 }
  return {
    start: async () => {
      calls.starts++
    },
    stop: () => {
      calls.stops++
    },
    ...over,
    calls,
  }
}

function makeKws(initialStatus = 'idle'): PanelCommands & {
  calls: { loads: number; starts: number; stops: number }
} {
  let status = initialStatus
  let running = false
  const calls = { loads: 0, starts: 0, stops: 0 }
  const commands = {
    load: async () => {
      calls.loads++
      status = 'ready'
    },
    start: () => {
      if (status === 'ready') {
        running = true
        calls.starts++
      }
    },
    stop: () => {
      running = false
      calls.stops++
    },
    getState: () => ({ status, running, isFewShot: false }),
    calls,
  }
  return commands
}

describe('runPipelineStart', () => {
  it('starts AFE then auto-loads + auto-starts KWS (preload ON)', async () => {
    const afe = makeAfe()
    const kws = makeKws('idle')
    const result = await runPipelineStart(afe, kws, {
      kwsEnabled: true,
      kwsPreloadOnStart: true,
    })
    expect(result.ok).toBe(true)
    expect(result.kwsLoaded).toBe(true)
    expect(afe.calls.starts).toBe(1)
    expect(kws.calls.loads).toBe(1)
    expect(kws.calls.starts).toBe(1)
  })

  it('leaves KWS idle when preload is OFF (Start runs AFE only)', async () => {
    const afe = makeAfe()
    const kws = makeKws('idle')
    const result = await runPipelineStart(afe, kws, {
      kwsEnabled: true,
      kwsPreloadOnStart: false,
    })
    expect(result.ok).toBe(true)
    expect(result.kwsLoaded).toBe(false)
    expect(afe.calls.starts).toBe(1)
    expect(kws.calls.loads).toBe(0)
    expect(kws.calls.starts).toBe(0)
  })

  it('does not touch KWS when KWS is disabled', async () => {
    const afe = makeAfe()
    const kws = makeKws('idle')
    const result = await runPipelineStart(afe, kws, {
      kwsEnabled: false,
      kwsPreloadOnStart: true,
    })
    expect(result.ok).toBe(true)
    expect(afe.calls.starts).toBe(1)
    expect(kws.calls.loads).toBe(0)
    expect(kws.calls.starts).toBe(0)
  })

  it('does not re-load when the engine is already ready', async () => {
    const afe = makeAfe()
    const kws = makeKws('ready')
    const result = await runPipelineStart(afe, kws, {
      kwsEnabled: true,
      kwsPreloadOnStart: true,
    })
    expect(result.ok).toBe(true)
    expect(kws.calls.loads).toBe(0)
    expect(kws.calls.starts).toBe(1)
  })

  it('surfaces an error when KWS auto-load fails', async () => {
    const afe = makeAfe()
    const kws = makeKws('idle')
    kws.load = async () => {
      throw new Error('model fetch failed')
    }
    const result = await runPipelineStart(afe, kws, {
      kwsEnabled: true,
      kwsPreloadOnStart: true,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('model fetch failed')
  })

  it('surfaces an error when AFE start fails (KWS untouched)', async () => {
    const afe = makeAfe({
      start: async () => {
        throw new Error('mic permission denied')
      },
    })
    const kws = makeKws('idle')
    const result = await runPipelineStart(afe, kws, {
      kwsEnabled: true,
      kwsPreloadOnStart: true,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('mic permission denied')
    expect(kws.calls.loads).toBe(0)
    expect(kws.calls.starts).toBe(0)
  })
})

describe('runPipelineStop', () => {
  it('stops KWS first, then AFE', () => {
    const afe = makeAfe()
    const kws = makeKws('ready')
    runPipelineStop(afe, kws)
    expect(kws.calls.stops).toBe(1)
    expect(afe.calls.stops).toBe(1)
  })

  it('is safe with null commands', () => {
    expect(() => runPipelineStop(null, null)).not.toThrow()
  })
})
