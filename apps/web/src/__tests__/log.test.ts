/**
 * Log store unit tests.
 *
 * Covers the ring-buffer cap, trigger recording, and CSV export escaping.
 * These functions are pure-ish (module store); we clear between tests.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearLog,
  getLogEntries,
  getTriggerEntries,
  logInfo,
  logWarn,
  logError,
  logTrigger,
  triggersToCsv,
  LOG_CAP,
} from '../log'

beforeEach(() => {
  clearLog()
})

describe('log store', () => {
  it('records info/warn/error entries with source + message', () => {
    logInfo('afe', 'started')
    logWarn('kws', 'threshold low')
    logError('kws', 'load failed')
    const all = getLogEntries()
    expect(all).toHaveLength(3)
    expect(all[0].source).toBe('afe')
    expect(all[0].level).toBe('info')
    expect(all[1].level).toBe('warn')
    expect(all[2].level).toBe('error')
  })

  it('caps the ring buffer at LOG_CAP', () => {
    for (let i = 0; i < LOG_CAP + 50; i++) logInfo('src', `e${i}`)
    const all = getLogEntries()
    expect(all.length).toBe(LOG_CAP)
    // Oldest dropped; newest retained.
    expect(all[0].message).toBe(`e${50}`)
    expect(all[all.length - 1].message).toBe(`e${LOG_CAP + 49}`)
  })

  it('records triggers separately from plain log entries', () => {
    logInfo('afe', 'started')
    logTrigger('kws', { triggeredAtMs: 1, peakScore: 0.92, word: 'hey studio' })
    const triggers = getTriggerEntries()
    expect(triggers).toHaveLength(1)
    expect(triggers[0].trigger?.word).toBe('hey studio')
    expect(triggers[0].trigger?.peakScore).toBe(0.92)
  })
})

describe('triggersToCsv', () => {
  it('produces a header + one row per trigger', () => {
    logTrigger('kws', { triggeredAtMs: 1, peakScore: 0.9, word: 'hey' })
    logTrigger('kws', { triggeredAtMs: 2, peakScore: 0.7, word: 'jarvis' })
    const csv = triggersToCsv(getTriggerEntries())
    const lines = csv.split('\n')
    expect(lines[0]).toBe('time,word,peak_score')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('hey')
    expect(lines[2]).toContain('jarvis')
  })

  it('escapes commas and quotes in words', () => {
    logTrigger('kws', { triggeredAtMs: 1, peakScore: 0.5, word: 'a, "quoted"' })
    const csv = triggersToCsv(getTriggerEntries())
    expect(csv).toContain('"a, ""quoted"""')
  })

  it('returns just the header for no triggers', () => {
    expect(triggersToCsv([])).toBe('time,word,peak_score')
  })
})
