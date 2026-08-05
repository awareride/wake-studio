/**
 * AFE pipeline AudioWorklet processor (single-worklet topology, ADR-016).
 *
 * Runs the stage chain AEC -> BSS -> NS at 48 kHz inside a single AudioWorklet
 * by **driving each stage module through the AFEStage interface** (ADR-025):
 *   - AEC: `@wake-studio/module-afe-aec` AecStage (passthrough for v1, ADR-016)
 *   - BSS: `@wake-studio/module-afe-bss` BssStage (passthrough for v1, ADR-016)
 *   - NS:  `@wake-studio/module-rnnoise` RnnoiseNsStage (RNNoise WASM, denoises
 *          480-sample frames in place)
 *
 * The stage engines are pure TS over their own wasm interfaces - no DOM, so
 * they import cleanly into the AudioWorkletGlobalScope. The graph module owns
 * only the *scheduling* (circular buffer, frame assembly, viz throttling,
 * recording) - not the stage DSP.
 *
 * Emits per-stage visualization data (throttled to vizFps) and 16 kHz output
 * frames (160 samples / 10 ms) for downstream KWS.
 */

// Stage modules (pure TS cores; see above). The NS stage's wasm glue is
// imported from the rnnoise module's web target (synchronous, base64-embedded).
import { AecStage } from '@wake-studio/module-afe-aec'
import { BssStage } from '@wake-studio/module-afe-bss'
import { loadRnnoiseStage } from '@wake-studio/module-rnnoise/web'

import type { MainMessage, StageFrameData, WorkletMessage } from '../core/types'
import { CIRCULAR_BUFFER_SIZE, RNNOISE_FRAME_SIZE } from '../core/defaults'
import { computeSpectrum, downsample48to16, downsampleForViz, levelDb } from '../core/dsp'

const PROCESSOR_NAME = 'pipeline-processor'

class PipelineProcessor extends AudioWorkletProcessor {
  // Stage modules, driven through the AFEStage interface.
  private _aec: AecStage
  private _bss: BssStage
  private _ns: ReturnType<typeof loadRnnoiseStage> | null = null

  // Circular buffer (LCM(128, 480) = 1920 samples).
  private _buffer = new Float32Array(CIRCULAR_BUFFER_SIZE)
  private _inputLength = 0
  private _denoisedLength = 0
  private _denoisedIndex = 0

  // Viz throttling.
  private _lastVizTime = 0
  private _vizInterval = 1 / 30 // seconds; updated from config

  // Config (updated via messages).
  private _bypass = { aec: true, bss: true, ns: false }
  private _abSource: 'raw' | 'processed' = 'processed'

  // Recording state.
  private _recording = false
  private _recordRemaining = 0
  private _rawRecord: Float32Array | null = null
  private _processedRecord: Float32Array | null = null
  private _recordOffset = 0

  // Last denoised NS frame (always available for viz, even during buffer wrap-around).
  private _lastNsFrame = new Float32Array(RNNOISE_FRAME_SIZE)
  private _hasNsFrame = false

  constructor() {
    super()

    // AEC + BSS: passthrough engines (v1).
    this._aec = new AecStage()
    this._bss = new BssStage()

    // NS: RNNoise, synchronously instantiated (addModule doesn't await promises).
    try {
      this._ns = loadRnnoiseStage()
    } catch (err) {
      this._ns = null
      this._post({ type: 'error', message: `RNNoise init failed: ${String(err)}` })
    }

    this.port.onmessage = (e: MessageEvent<MainMessage>) => {
      this._handleMessage(e.data)
    }

    this._post({ type: 'ready' })
  }

  private _handleMessage(msg: MainMessage): void {
    switch (msg.type) {
      case 'config':
        this._bypass = msg.bypass
        this._vizInterval = 1 / msg.vizFps
        break
      case 'absource':
        this._abSource = msg.source
        break
      case 'record': {
        const total = Math.floor(msg.seconds * sampleRate)
        this._rawRecord = new Float32Array(total)
        this._processedRecord = new Float32Array(total)
        this._recordRemaining = total
        this._recordOffset = 0
        this._recording = true
        break
      }
      case 'stop':
        // The node is destroyed from the main thread; nothing to do here.
        break
    }
  }

  private _post(msg: WorkletMessage): void {
    this.port.postMessage(msg)
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const inData = inputs[0]?.[0]
    const outData = outputs[0]?.[0]
    if (!inData) return true

    // --- 1. Append raw input to the circular buffer ---
    this._buffer.set(inData, this._inputLength)
    this._inputLength += inData.length

    // --- 2. Run the stage chain over 480-sample frames ---
    while (this._denoisedLength + RNNOISE_FRAME_SIZE <= this._inputLength) {
      const frame = this._buffer.subarray(
        this._denoisedLength,
        this._denoisedLength + RNNOISE_FRAME_SIZE,
      )

      // AEC -> BSS -> NS through the AFEStage interface.
      // AEC/BSS: passthrough engines for v1 (their process() is a no-op on the
      // frame, but the interface call keeps the chain honest + future-proof).
      let vad = 0
      if (!this._bypass.aec) this._aec.process(frame)
      if (!this._bypass.bss) this._bss.process(frame)
      if (!this._bypass.ns && this._ns) {
        vad = this._ns.process(frame).vadProbability
      }

      // Keep a copy of the last NS frame for stable visualization
      // (avoids intermittent missing data during circular-buffer wrap-around).
      this._lastNsFrame.set(frame)
      this._hasNsFrame = true

      // Downsample to 16 kHz and post output for KWS.
      const out160 = downsample48to16(frame)
      this._post({
        type: 'output',
        samples: out160,
        capturedAtMs: currentTime,
        vad,
      })

      this._denoisedLength += RNNOISE_FRAME_SIZE
    }

    // --- 3. Copy denoised audio to the output quantum (for monitoring) ---
    let unsent: number
    if (this._denoisedIndex > this._denoisedLength) {
      unsent = CIRCULAR_BUFFER_SIZE - this._denoisedIndex
    } else {
      unsent = this._denoisedLength - this._denoisedIndex
    }

    if (unsent >= outData.length) {
      const chunk = this._buffer.subarray(
        this._denoisedIndex,
        this._denoisedIndex + outData.length,
      )
      // During recording, always output processed so the user hears denoised audio.
      const source = this._recording ? 'processed' : this._abSource
      if (source === 'processed') {
        outData.set(chunk)
      } else {
        // Raw: the input we just received (for A/B comparison).
        outData.set(inData)
      }
      this._denoisedIndex += outData.length
    }

    // --- 3b. Recording: capture raw + processed ---
    if (this._recording && this._rawRecord && this._processedRecord) {
      const n = Math.min(inData.length, this._recordRemaining)
      this._rawRecord.set(inData.subarray(0, n), this._recordOffset)
      this._processedRecord.set(outData.subarray(0, n), this._recordOffset)
      this._recordOffset += n
      this._recordRemaining -= n
      if (this._recordRemaining <= 0) {
        this._recording = false
        this._post({
          type: 'recorded',
          raw: this._rawRecord,
          processed: this._processedRecord,
          sampleRate,
        })
        this._rawRecord = null
        this._processedRecord = null
      }
    }

    // --- 4. Handle circular buffer wrap-around ---
    if (this._denoisedIndex >= CIRCULAR_BUFFER_SIZE) {
      this._denoisedIndex = 0
    }
    if (this._inputLength >= CIRCULAR_BUFFER_SIZE) {
      this._inputLength = 0
      this._denoisedLength = 0
    }

    // --- 5. Post visualization data (throttled to vizFps) ---
    if (currentTime - this._lastVizTime >= this._vizInterval) {
      this._lastVizTime = currentTime
      this._postVizData(inData)
    }

    return true
  }

  private _postVizData(rawInput: Float32Array): void {
    const capturedAtMs = currentTime
    const vizPoints = 128
    const frames: StageFrameData[] = []

    // AEC stage (passthrough for v1): shows raw input.
    frames.push({
      stageId: 'aec',
      kind: 'aec',
      capturedAtMs,
      waveform: downsampleForViz(rawInput, vizPoints),
      levelDb: levelDb(rawInput),
    })

    // BSS stage (passthrough): same as AEC output.
    frames.push({
      stageId: 'bss',
      kind: 'bss',
      capturedAtMs,
      levelDb: levelDb(rawInput),
    })

    // NS stage: always use the last denoised frame (stable, no intermittent gaps).
    const nsFrame = this._hasNsFrame
      ? this._lastNsFrame
      : rawInput.subarray(0, Math.min(RNNOISE_FRAME_SIZE, rawInput.length))
    frames.push({
      stageId: 'ns',
      kind: 'ns',
      capturedAtMs,
      waveform: downsampleForViz(nsFrame, vizPoints),
      levelDb: levelDb(nsFrame),
      spectrum: computeSpectrum(nsFrame),
    })

    this._post({ type: 'frame', frames })
  }
}

registerProcessor(PROCESSOR_NAME, PipelineProcessor)
