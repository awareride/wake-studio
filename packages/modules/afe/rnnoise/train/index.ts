/**
 * RNNoise module - train target metadata (consumed by the studio-backend
 * `train-runner.ts` and CI `train-rnnoise.yml`, ADR-028).
 */

export const RNNOISE_TRAIN = {
  /** uv project directory (relative to module root). */
  projectDir: 'train',
  /** Entrypoint run as `uv run --project train python train.py`. */
  entry: 'train.py',
  /** Env var that controls where outputs land. */
  outDirEnv: 'MODULE_OUT_DIR',
  outputs: {
    checkpoint: 'out/rnnoise.onnx',
    metrics: 'out/metrics.json',
  },
  /** Invocation: CI only (studio-backend will use this metadata too). */
  invocation: ['ci', 'subprocess'] as const,
} as const
