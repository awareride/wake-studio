/**
 * ASR-Decoding token matching (pure logic, no sherpa-onnx dependency).
 *
 * The ASR-Decoding KWS approach (docs/kws-categories.md §2.2):
 *   1. A streaming ASR engine decodes speech into a token sequence (words).
 *   2. We match that sequence against an editable wake-word list.
 *   3. A match yields a trigger; the match confidence becomes the KWS "score"
 *      so the shared dispatcher / panel / trigger logic work unchanged.
 *
 * Matching is deliberately simple and explainable:
 *   - Wake phrases and decoded text are normalized (lowercase, punctuation
 *     stripped, collapsed whitespace) into token arrays.
 *   - A wake phrase MATCHES a decoded segment if the phrase's token sequence
 *     appears as a contiguous subsequence (word-boundary aware) of the decoded
 *     tokens. This catches "hey siri play music" -> matches "hey siri".
 *   - Confidence: exact contiguous match = 1.0. A fuzzy fallback scores by
 *     1 - normalizedLevenshtein / maxLen so a near-miss still surfaces a
 *     partial score below threshold (useful for tuning).
 *
 * These functions are unit-tested in src/asr/__tests__/matching.test.ts.
 */

import type { MatchResult, WakeWordEntry } from './types'

/** Punctuation + whitespace normalization for token matching. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // drop punctuation, keep letters/numbers
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
}

/** Split normalized text into tokens (words). */
export function tokenize(text: string): string[] {
  return normalizeText(text).split(' ').filter(Boolean)
}

/** Contiguous-subsequence check: does `needle` appear in `haystack`? */
export function isContiguousSubsequence(
  needle: string[],
  haystack: string[],
): boolean {
  if (needle.length === 0) return false
  if (needle.length > haystack.length) return false
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let ok = true
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

/**
 * Normalized Levenshtein distance (0..1) between two token arrays.
 * Used as the fuzzy fallback confidence estimator.
 */
export function tokenEditDistance(a: string[], b: string[]): number {
  const n = a.length
  const m = b.length
  if (n === 0) return m
  if (m === 0) return n
  // Rolling two rows to keep memory O(m).
  let prev = new Array<number>(m + 1)
  let curr = new Array<number>(m + 1)
  for (let j = 0; j <= m; j++) prev[j] = j
  for (let i = 1; i <= n; i++) {
    curr[0] = i
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[m]
}

/** Convert a token-edit distance to a [0,1] confidence. */
export function editDistanceToConfidence(dist: number, len: number): number {
  if (len === 0) return 0
  return Math.max(0, 1 - dist / len)
}

/**
 * Match a decoded token sequence against the (enabled) wake-word list.
 *
 * Returns the best match: the highest-confidence enabled entry that is either
 * an exact contiguous subsequence (confidence 1.0) or, failing that, the
 * highest fuzzy confidence within a sane window.
 */
export function matchWakeWords(
  decodedTokens: string[],
  wakeWords: WakeWordEntry[],
  normalize: boolean,
): MatchResult {
  const empty: MatchResult = {
    matched: null,
    confidence: 0,
    decodedText: decodedTokens.join(' '),
  }
  if (decodedTokens.length === 0) return empty

  const active = wakeWords.filter((w) => w.enabled && w.text.trim().length > 0)
  if (active.length === 0) return empty

  let best: MatchResult = empty
  for (const entry of active) {
    let phraseTokens = tokenize(entry.text)
    const haystack = decodedTokens
    if (!normalize) {
      // If normalization is disabled, match case/punctuation literally.
      phraseTokens = entry.text.trim().split(/\s+/).filter(Boolean)
    }
    if (phraseTokens.length === 0) continue

    if (isContiguousSubsequence(phraseTokens, haystack)) {
      // Exact contiguous match -> full confidence.
      if (1 > best.confidence) {
        best = { matched: entry, confidence: 1, decodedText: decodedTokens.join(' ') }
      }
      continue
    }

    // Fuzzy fallback: compare the decoded tail (last phraseTokens.length
    // tokens, a common slip window) against the phrase.
    const window = haystack.slice(-phraseTokens.length)
    const dist = tokenEditDistance(phraseTokens, window)
    const conf = editDistanceToConfidence(dist, phraseTokens.length)
    if (conf > best.confidence) {
      best = { matched: entry, confidence: conf, decodedText: decodedTokens.join(' ') }
    }
  }
  return best
}
