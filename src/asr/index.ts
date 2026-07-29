/**
 * ASR-Decoding KWS module - public exports.
 *
 * @see docs/kws-categories.md §2.2 (ADR-024)
 */

export { AsrDecodeBackend, ASR_DEFAULT_CONFIG } from './AsrDecodeBackend'
export { matchWakeWords, tokenize, normalizeText, isContiguousSubsequence } from './matching'
export type {
  AsrDecodeConfig,
  WakeWordEntry,
  AsrSegment,
  MatchResult,
} from './types'
