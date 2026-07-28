/**
 * Few-Shot recorder AudioWorklet (replaces the deprecated ScriptProcessorNode).
 *
 * Captures mono float32 PCM from a MediaStreamSource and posts fixed-size
 * chunks to the main thread. The main thread concatenates them into one
 * 16 kHz buffer for enrollment embedding. Runs off-main-thread (no jank,
 * no deprecation warning) and matches the AFE's AudioWorklet topology.
 */

interface RecorderMessage {
  type: 'chunk'
  samples: Float32Array
}

class RecorderProcessor extends AudioWorkletProcessor {
  // 128-sample render quantum (AudioWorklet fixed size).
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]
    if (input && input[0]) {
      // Copy: the buffer is reused by the worklet after process() returns.
      const ch = new Float32Array(input[0].length)
      ch.set(input[0])
      const msg: RecorderMessage = { type: 'chunk', samples: ch }
      // Transfer the underlying buffer to avoid a copy on the main thread.
      this.port.postMessage(msg, [ch.buffer])
    }
    return true
  }
}

registerProcessor('few-shot-recorder', RecorderProcessor)

// Keep `sampleRate` referenced for type-checkers that lint unused globals.
export {}
