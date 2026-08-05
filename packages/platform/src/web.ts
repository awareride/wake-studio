/**
 * platform - browser-only implementations of the runtime seams (./web).
 *
 * WebAudio capture behind the AudioSource seam, so modules (AFE graph,
 * Few-Shot recorder) depend on the seam, not on `window`/`AudioContext`
 * directly.
 */

import type { AudioSource } from './seams'

/** WebAudio-based mic capture (16 kHz mono by default). */
export function createMicrophoneSource(
  audioContext: AudioContext,
  targetSampleRate = 16000,
): AudioSource {
  let stream: MediaStream | null = null
  let source: MediaStreamAudioSourceNode | null = null
  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      source = audioContext.createMediaStreamSource(stream)
      // The AudioWorklet the AFE graph owns connects to this node; sample-rate
      // conversion to the target rate happens in the graph/worklet.
      void targetSampleRate
    },
    stop() {
      stream?.getTracks().forEach((t) => t.stop())
      source?.disconnect()
      stream = null
      source = null
    },
  }
}
