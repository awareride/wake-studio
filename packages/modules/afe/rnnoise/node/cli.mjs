/**
 * RNNoise module - CLI (invoked by the local service / humans).
 *
 * Reads 480-sample float32 frames from stdin (little-endian), denoises them,
 * and writes the denoised frames to stdout. Used by the local-service
 * `train-runner.ts`-style subprocess invocations and manual testing.
 *
 *   cat frames.f32 | node node/cli.mjs > denoised.f32
 */

import { loadRnnoiseNode } from './index'
import { RNNOISE_FRAME_SIZE } from '../core'

const engine = loadRnnoiseNode({ strength: 1, denoiseEnabled: true })
const input = new Float32Array(RNNOISE_FRAME_SIZE)
const out = new Float32Array(RNNOISE_FRAME_SIZE)
const bytes = new Uint8Array(RNNOISE_FRAME_SIZE * 4)

process.stdin.on('readable', () => {
  let chunk: Buffer | null
  let offset = 0
  while ((chunk = process.stdin.read()) !== null) {
    for (let i = 0; i < chunk.length && offset < bytes.length; i++) {
      bytes[offset++] = chunk[i]
    }
    if (offset >= bytes.length) {
      const view = new DataView(bytes.buffer)
      for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
        input[i] = view.getFloat32(i * 4, true)
      }
      out.set(input)
      engine.processFrame(out)
      const outView = new DataView(out.buffer)
      const outBytes = Buffer.alloc(RNNOISE_FRAME_SIZE * 4)
      for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
        outBytes.writeFloatLE(out[i], i * 4)
      }
      process.stdout.write(outBytes)
      offset = 0
    }
  }
})

process.stdin.on('end', () => {
  engine.destroy()
})
