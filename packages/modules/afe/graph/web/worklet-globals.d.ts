/**
 * Minimal type declarations for AudioWorkletGlobalScope globals.
 * Avoids a dependency on @types/audioworklet (which requires @types/audioworklet
 * to be installed). Only declares what the worklet uses.
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
