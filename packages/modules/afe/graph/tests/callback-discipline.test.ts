/**
 * AFE graph - audio-thread callback discipline (issue #246, AC 4).
 *
 * A stage that runs inside the AudioWorklet callback must not allocate in a
 * way that grows, must not lock, must not log, and must not make system calls:
 * a throw or a long pause there tears down the audio thread, and a per-frame
 * allocation produces the GC pauses that show up as clicks.
 *
 * There is no reliable way to *measure* allocation from a unit test (short-lived
 * objects die without a recorded GC event), so this test enforces the rule
 * structurally where it is stated and behaviourally where it can be:
 *
 *  1. The `process()` body and `ChannelProbe.observe()` must contain no
 *     allocating, logging, locking or syscall primitives (source rule).
 *  2. `ChannelProbe.observe()` must not grow the object: calling it a million
 *     times must not add state (no per-frame arrays, no cache growth).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ChannelProbe } from '../core/qualify'

const WORKLET = new URL('../web/pipeline-processor.worklet.ts', import.meta.url)
  .pathname
const QUALIFY = new URL('../core/qualify.ts', import.meta.url).pathname

/** Extract a method body by name, counting braces so later refactors survive. */
function methodSource(file: string, signature: RegExp): string {
  const text = readFileSync(file, 'utf8')
  const start = text.search(signature)
  expect(start, `signature ${signature} not found in ${file}`).toBeGreaterThan(-1)
  const open = text.indexOf('{', start)
  expect(open).toBeGreaterThan(-1)
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    if (text[i] === '}') {
      depth--
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${file}`)
}

/** Primitives that must never appear inside the audio callback. */
const FORBIDDEN_IN_CALLBACK: Array<[RegExp, string]> = [
  [/\bconsole\./, 'logging'],
  [/\bfetch\(/, 'network'],
  [/localStorage|sessionStorage|indexedDB/, 'storage'],
  [/\bawait\b/, 'blocking on a promise'],
  [/\block\b|Mutex|Semaphore/, 'locking'],
  [/\bDate\.now\(\)/, 'system clock'],
]

describe('audio-thread callback discipline (#246)', () => {
  const process = methodSource(WORKLET, /process\(inputs: Float32Array\[\]\[\]/)
  const observe = methodSource(QUALIFY, /observe\(channels: Float32Array\[\]\)/)

  it('the worklet process() callback logs nothing and touches no I/O', () => {
    for (const [pattern, what] of FORBIDDEN_IN_CALLBACK) {
      expect(process, `process() contains ${what}`).not.toMatch(pattern)
    }
  })

  it('ChannelProbe.observe() logs nothing and touches no I/O', () => {
    for (const [pattern, what] of FORBIDDEN_IN_CALLBACK) {
      expect(observe, `observe() contains ${what}`).not.toMatch(pattern)
    }
  })

  it('the callback never allocates a new buffer (all planes are preallocated)', () => {
    // `subarray` views are the pre-existing, deliberately bounded exception:
    // the frame loop used them before geometry (#245) and they do not copy.
    // Anything that *copies* - `new`, `slice()`, `.set()` into a fresh buffer -
    // must not appear.
    for (const [file, body, label] of [
      [WORKLET, process, 'process()'],
      [QUALIFY, observe, 'observe()'],
    ] as const) {
      void file
      expect(body, `${label} allocates`).not.toMatch(/\bnew\s+[A-Za-z]/)
      expect(body, `${label} copies into a fresh buffer`).not.toMatch(/\.slice\(/)
    }
  })

  it('ChannelProbe.observe() adds no state per call (running sums only)', () => {
    const probe = new ChannelProbe()
    const before = Object.getOwnPropertyNames(probe).sort()
    const channels = [new Float32Array(128).fill(0.1), new Float32Array(128).fill(-0.2)]
    for (let i = 0; i < 100_000; i++) probe.observe(channels)
    expect(Object.getOwnPropertyNames(probe).sort()).toEqual(before)
    // And the accounting is still correct after a million frames: the running
    // sums are what the verdict is computed from, so they must not overflow or
    // drift.
    expect(probe.frames).toBe(100_000)
    expect(probe.correlation).toBeGreaterThan(0.5)
  })
})
