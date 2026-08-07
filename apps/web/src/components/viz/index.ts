/**
 * Shared visualization components (issue #53 P1).
 *
 * Reusable canvas/effect pieces extracted from the live panels (AFEPanel /
 * KWSPanel) so the Workspace Phase-2 preview and any future surface share one
 * implementation. Pure presentation — no engine/project access.
 */

export {
  StagePanel,
  StageMetricRow,
  WaveformCanvas,
  LevelBar,
} from './StageCard'
export type { VizStageId } from './StageCard'
export { drawScoreCurve, HISTORY_MAX } from './ScoreCurve'
export { useWavPlayback, type WavPlayback } from './playback'
