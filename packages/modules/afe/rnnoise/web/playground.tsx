/**
 * RNNoise playground - standalone module experience page (ADR-025 §4.5).
 *
 * Spec-driven: params/actions render via the module-kit Ui controls
 * (ModuleSpec -> mapper -> Radix/Tailwind), live status via the Ui* canvas
 * visualizations. Demonstrates the ADR-025 panel-generator contract without
 * a hand-written panel.
 */

import { useEffect, useRef, useState } from 'react'
import { UiSlider, UiToggle, UiButton, UiWaveform, UiCurve, UiBar, UiCollapsible } from '@wake-studio/module-kit'
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
  // History for the score curve (last 120 processed frames).
  const historyRef = useRef<number[]>([])
  const [input, setInput] = useState<number[]>([])
  const [output, setOutput] = useState<number[]>([])
  const [curveData, setCurveData] = useState<number[]>([])
  const [advancedOpen, setAdvancedOpen] = useState(false)

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
    const inputFrame = synthFrame(noiseLevel, Date.now() % 10000)
    const outFrame = new Float32Array(inputFrame)
    setInput(Array.from(inputFrame))
    setInRms(frameRms(inputFrame))
    const result = engine.processFrame(outFrame)
    setOutput(Array.from(outFrame))
    setVad(result.vadProbability)
    setOutRms(frameRms(outFrame))
    historyRef.current.push(result.vadProbability)
    if (historyRef.current.length > 120) historyRef.current.shift()
    setCurveData([...historyRef.current])
  }

  const handleReset = () => {
    historyRef.current = []
    setCurveData([])
    setVad(0)
    setInRms(0)
    setOutRms(0)
    setInput([])
    setOutput([])
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-12">
      <h2 className="text-lg font-semibold text-white">
        RNNoise module playground
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        ADR-025 pilot · vendored emscripten wasm, runs fully in-browser. No
        AFE, no KWS — just this module. Controls are spec-driven (module-kit
        Ui* components).
      </p>

      {!ready && <p className="mt-4 text-amber-300">Loading RNNoise WASM…</p>}

      <div className="mt-6 space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        {/* Primary params (spec-driven controls). */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="w-28 shrink-0 text-sm text-slate-300">Noise level</span>
            <div className="flex-1">
              <UiSlider
                value={noiseLevel}
                min={0}
                max={1}
                step={0.05}
                onChange={setNoiseLevel}
                ariaLabel="Noise level"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="w-28 shrink-0 text-sm text-slate-300">Strength</span>
            <div className="flex-1">
              <UiSlider
                value={strength}
                min={0}
                max={1}
                step={0.1}
                onChange={setStrength}
                ariaLabel="Strength"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="w-28 shrink-0 text-sm text-slate-300">Denoise</span>
            <UiToggle
              checked={denoiseEnabled}
              onChange={setDenoiseEnabled}
              label="Denoise frames"
            />
          </div>
        </div>

        {/* Advanced (collapsible, ADR-024 dual layer). */}
        <UiCollapsible
          label="Advanced"
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <div className="rounded-lg border border-white/10 bg-slate-900/40 p-4 text-xs text-slate-400">
            <p>
              Sample rate {SAMPLE_RATE / 1000} kHz · frame size{' '}
              {RNNOISE_FRAME_SIZE} samples (10 ms) · RNNoise wasm embedded as
              base64 in the vendored glue.
            </p>
          </div>
        </UiCollapsible>

        {/* Actions. */}
        <div className="flex gap-3 pt-2">
          <UiButton
            label="Process one frame"
            onClick={handleStep}
            variant="primary"
            disabled={!ready}
          />
          <UiButton label="Reset" onClick={handleReset} variant="secondary" />
        </div>

        {/* Status: waveform + curve + VAD bar. */}
        <div className="grid gap-4 pt-2 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-800/60 p-3">
            <div className="mb-1 text-xs uppercase tracking-wider text-slate-500">
              Waveform (input vs denoised)
            </div>
            <UiWaveform data={output} overlay={input} height={56} />
          </div>
          <div className="rounded-lg bg-slate-800/60 p-3">
            <div className="mb-1 text-xs uppercase tracking-wider text-slate-500">
              VAD history
            </div>
            <UiCurve data={curveData} threshold={0.5} height={56} />
          </div>
        </div>

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
            <div className="mt-1 text-lg text-emerald-300">{outRms.toFixed(3)}</div>
          </div>
          <div className="rounded-lg bg-slate-800/60 p-3">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              VAD
            </div>
            <UiBar value={vad} threshold={0.5} height={6} className="mt-2" />
          </div>
        </div>
      </div>
    </section>
  )
}
