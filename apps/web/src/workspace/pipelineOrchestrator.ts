/**
 * Pipeline lifecycle orchestration (epic #53 P4) - pure, React-free.
 *
 * The unified Start/Stop order lives here so it is unit-testable without
 * React or testing-library:
 *
 *   start: AFE start → (KWS enabled + preload ON) auto-load if not ready →
 *          KWS start detection
 *   stop:  KWS stop → AFE stop
 */

import type { PanelCommands } from './usePipelineRunner'

export interface LifecycleResult {
  ok: boolean
  /** Error message when !ok. */
  error?: string
  /** True when KWS was auto-loaded on this Start. */
  kwsLoaded?: boolean
}

export interface LifecycleFlags {
  kwsEnabled: boolean
  kwsPreloadOnStart: boolean
}

/**
 * Run the Start sequence. Returns { ok: true } or { ok: false, error }.
 * The AFE start must resolve before KWS is touched.
 */
export async function runPipelineStart(
  afe: PanelCommands | null | undefined,
  kws: PanelCommands | null | undefined,
  flags: LifecycleFlags,
): Promise<LifecycleResult> {
  if (!afe) return { ok: false, error: 'AFE not ready.' }

  // 1. AFE first.
  try {
    await afe.start()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // 2. KWS if enabled + available.
  if (!flags.kwsEnabled || !kws) return { ok: true }

  const kwsState = kws.getState?.() ?? { status: 'idle', running: false, hasProvision: false }

  // Auto-load when preload is ON and the engine is not ready yet.
  let kwsLoaded = false
  if (
    flags.kwsPreloadOnStart &&
    kwsState.status !== 'ready' &&
    kwsState.status !== 'running'
  ) {
    try {
      if (kws.load) {
        await kws.load()
        kwsLoaded = true
      }
    } catch (err) {
      return {
        ok: false,
        error: `KWS model load failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // Start detection (no-op when preload OFF and not ready - the panel's
  // start guards on ready + AFE running).
  kws.start?.()
  return { ok: true, kwsLoaded }
}

/** Run the Stop sequence: KWS first (unsubscribes from AFE output), then AFE. */
export function runPipelineStop(
  afe: PanelCommands | null | undefined,
  kws: PanelCommands | null | undefined,
): void {
  kws?.stop?.()
  afe?.stop?.()
}
