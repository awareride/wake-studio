/**
 * Minimal type declarations for AudioWorkletGlobalScope globals.
 * Avoids a dependency on @types/audioworklet. Only declares what the app's
 * worklets use. Kept in apps/web until the few-shot recorder moves to its
 * module (§6.4); the afe-graph module declares its own copy.
 */

declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => unknown,
): void

/** The current sample rate of the AudioContext, in Hz. */
declare const sampleRate: number

/** The elapsed time of the AudioContext, in seconds. */
declare const currentTime: number

/** The current frame count of the AudioContext. */
declare const currentFrame: number

/** Base class for AudioWorkletProcessor (not in the standard DOM lib). */
interface AudioWorkletProcessor {
  readonly port: MessagePort
}

declare const AudioWorkletProcessor: {
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor
}
