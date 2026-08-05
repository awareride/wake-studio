/**
 * RNNoise playground - standalone module experience page (ADR-025 §4.5).
 *
 * Lets a user load the RNNoise wasm, generate a noisy sine frame, and see
 * denoising + VAD live. No AFE, no KWS - just this module.
 */

import { useEffect, useRef, useState } from 'react'
import { loadRnnoise, type RnnoiseModule } from './index'
import { RNNOISE_FRAME_SIZE } from '../core'
import { frameRms } from '../core/dsp'

const SAMPLE_RATE = 48000

/** Generate a frame: a sine tone + white noise scaled by `noiseLevel`. */
function synthFrame(noiseLevel: number, t: number): Float32Array {
  const frame = new Float32Array(RNNOISE_FRAME_SIZE)
  const freq = 440
  for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
    const n = (Math.random() - 0.5) * 2 * noiseLevel
    frame[i] = Math.sin((2 * Math.PI * freq * (t + i)) / SAMPLE_RATE) + n
  }
  return frame
}

export default function RnnoisePlayground() {
  const engineRef = useRef<RnnoiseModule | null>(null)
  const [ready, setReady] = useState(false)
  const [noiseLevel, setNoiseLevel] = useState(0.3)
  const [strength, setStrength] = useState(1)
  const [denoiseEnabled, setDenoiseEnabled] = useState(true)
  const [vad, setVad] = useState(0)
  const [inRms, setInRms] = useState(0)
  const [outRms, setOutRms] = useState(0)

  useEffect(() => {
    const engine = loadRnnoise({ strength, denoiseEnabled })
    engineRef.current = engine
    setReady(true)
    return () => engine.destroy()
  }, [])

  useEffect(() => {
    engineRef.current?.setConfig({ strength, denoiseEnabled })
  }, [strength, denoiseEnabled])

  const handleStep = () => {
    const engine = engineRef.current
    if (!engine) return
    const input = synthFrame(noiseLevel, Date.now() % 10000)
    const out = new Float32Array(input)
    setInRms(frameRms(input))
    const result = engine.processFrame(out)
    console.log('[rnnoise-playground] vad:', result.vadProbability, 'denoised:', result.denoised)
    setVad(result.vadProbability)
    setOutRms(frameRms(out))
  }

  return (
    <section className="mx-auto max-w-2xl px-6 py-12">
      <h2 className="text-lg font-semibold text-white">
        RNNoise module playground
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        ADR-025 pilot · vendored emscripten wasm, runs fully in-browser. No
        AFE, no KWS — just this module.
      </p>

      {!ready && <p className="mt-4 text-amber-300">Loading RNNoise WASM…</p>}

      <div className="mt-6 space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <span className="w-32">Noise level</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={noiseLevel}
            onChange={(e) => setNoiseLevel(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-10 text-right">{noiseLevel.toFixed(2)}</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <span className="w-32">Strength</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-10 text-right">{strength.toFixed(1)}</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={denoiseEnabled}
            onChange={(e) => setDenoiseEnabled(e.target.checked)}
          />
          Denoise frames
        </label>

        <button
          onClick={handleStep}
          disabled={!ready}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Process one frame
        </button>

        <div className="grid grid-cols-3 gap-4 pt-2 text-sm">
          <div className="rounded-lg bg-slate-800/60 p-3">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              Input RMS
            </div>
            <div className="mt-1 text-lg text-slate-200">{inRms.toFixed(3)}</div>
          </div>
          <div className="rounded-lg bg-slate-800/60 p-3">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              Output RMS
            </div>
            <div className="mt-1 text-lg text-emerald-300">
              {outRms.toFixed(3)}
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/60 p-3">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              VAD
            </div>
            <div className="mt-1 text-lg text-sky-300">{vad.toFixed(3)}</div>
          </div>
        </div>
      </div>
    </section>
  )
}
