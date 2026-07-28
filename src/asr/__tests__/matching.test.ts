import { describe, it, expect } from 'vitest'
import {
  normalizeText,
  tokenize,
  isContiguousSubsequence,
  tokenEditDistance,
  editDistanceToConfidence,
  matchWakeWords,
} from '../matching'
import type { WakeWordEntry } from '../types'

const ww = (text: string, id = 'a', enabled = true): WakeWordEntry => ({
  id,
  text,
  enabled,
})

describe('normalizeText / tokenize', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeText('  Hey,  SIRI!  ')).toBe('hey siri')
    expect(tokenize('Hey, SIRI!')).toEqual(['hey', 'siri'])
  })
})

describe('isContiguousSubsequence', () => {
  it('detects a phrase inside a longer decode', () => {
    expect(isContiguousSubsequence(['hey', 'siri'], ['play', 'hey', 'siri', 'music'])).toBe(true)
  })
  it('rejects a non-contiguous match', () => {
    expect(isContiguousSubsequence(['hey', 'siri'], ['hey', 'there', 'siri'])).toBe(false)
  })
  it('rejects when the needle is longer', () => {
    expect(isContiguousSubsequence(['a', 'b', 'c'], ['a', 'b'])).toBe(false)
  })
})

describe('tokenEditDistance / confidence', () => {
  it('is 0 for identical token arrays', () => {
    expect(tokenEditDistance(['hey', 'siri'], ['hey', 'siri'])).toBe(0)
    expect(editDistanceToConfidence(0, 2)).toBe(1)
  })
  it('scales with distance', () => {
    const d = tokenEditDistance(['hey', 'siri'], ['hey', 'sarah'])
    expect(d).toBeGreaterThan(0)
    expect(editDistanceToConfidence(d, 2)).toBeLessThan(1)
  })
})

describe('matchWakeWords', () => {
  it('returns exact contiguous match at confidence 1.0', () => {
    const r = matchWakeWords(tokenize('please hey siri play music'), [ww('hey siri')], true)
    expect(r.matched?.text).toBe('hey siri')
    expect(r.confidence).toBe(1)
  })

  it('ignores disabled wake words', () => {
    const r = matchWakeWords(tokenize('hey siri'), [ww('hey siri', 'a', false)], true)
    expect(r.matched).toBeNull()
  })

  it('returns null when nothing matches', () => {
    const r = matchWakeWords(tokenize('the weather is nice'), [ww('hey siri')], true)
    expect(r.matched).toBeNull()
    expect(r.confidence).toBe(0)
  })

  it('picks the best of multiple candidates', () => {
    const r = matchWakeWords(
      tokenize('hey jarvis'),
      [ww('hey siri', 'a'), ww('hey jarvis', 'b')],
      true,
    )
    expect(r.matched?.id).toBe('b')
    expect(r.confidence).toBe(1)
  })

  it('respects normalize=false (literal tokens)', () => {
    // With literal matching, punctuation-bearing decoded tokens won't match a
    // clean phrase, so no exact contiguous match -> falls to fuzzy/zero.
    const r = matchWakeWords(['hey', 'siri.'], [ww('hey siri')], false)
    expect(r.confidence).toBeLessThan(1)
  })
})
