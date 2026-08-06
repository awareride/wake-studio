/**
 * RNNoise playground - standalone module experience page (ADR-025 §4.5).
 *
 * Spec-driven: params/actions render via the module-kit Ui controls
 * (ModuleSpec -> mapper -> Radix/Tailwind), live status via the Ui* canvas
 * visualizations. Demonstrates the ADR-025 panel-generator contract without
 * a hand-written panel.
 */

import { useEffect, useRef, useState } from 'react'
import { UiSlider, UiToggle, UiButton, UiWaveform, UiCurve, UiBar, UiCollapsible, renderPanel, type ModulePanelController } from '@wake-studio/module-kit'
import { loadRnnoise, type RnnoiseModule } from './index'
import { RNNOISE_FRAME_SIZE } from '../core'
import { frameRms } from '../core/constants'
import { RNNOISE_SPEC } from '../spec'

// Generated panel from the real module spec (ADR-025 §3). The engine state is
// wired to it via a controller, proving the spec -> panel -> engine loop.
const RnnoiseGeneratedPanel = renderPanel(RNNOISE_SPEC)

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

  // Controller for the generated panel: spec params <-> engine config, live
  // status fed from the last processed frame.
  const generatedController: ModulePanelController = {
    values: {
      strength,
      denoiseEnabled,
    },
    setValue: (id, value) => {
      if (id === 'strength') setStrength(value as number)
      if (id === 'denoiseEnabled') setDenoiseEnabled(Boolean(value))
    },
    runAction: (actionId) => {
      if (actionId === 'load') {
        // Engine is eagerly created on mount; re-run a frame as a "load" demo.
        handleStep()
      }
      if (actionId === 'reset') handleReset()
    },
    status: {
      vadProbability: vad,
    },
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-12">
      <h2 className="text-lg font-semibold text-ink-1">
        RNNoise module playground
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        ADR-025 pilot · vendored emscripten wasm, runs fully in-browser. No
        AFE, no KWS — just this module. Controls are spec-driven (module-kit
        Ui* components).
      </p>

      {!ready && <p className="mt-4 text-warning">Loading RNNoise WASM…</p>}

      <div className="mt-6 space-y-4 rounded-xl border border-line bg-surface-2 p-5">
        {/* Primary params (spec-driven controls). */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="w-28 shrink-0 text-sm text-ink-2">Noise level</span>
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
            <span className="w-28 shrink-0 text-sm text-ink-2">Strength</span>
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
            <span className="w-28 shrink-0 text-sm text-ink-2">Denoise</span>
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
          <div className="rounded-lg border border-line bg-surface-3 p-4 text-xs text-ink-2">
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
          <div className="rounded-lg bg-surface-3 p-3">
            <div className="mb-1 text-xs uppercase tracking-wider text-ink-3">
              Waveform (input vs denoised)
            </div>
            <UiWaveform data={output} overlay={input} height={56} />
          </div>
          <div className="rounded-lg bg-surface-3 p-3">
            <div className="mb-1 text-xs uppercase tracking-wider text-ink-3">
              VAD history
            </div>
            <UiCurve data={curveData} threshold={0.5} height={56} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 pt-2 text-sm">
          <div className="rounded-lg bg-surface-3 p-3">
            <div className="text-xs uppercase tracking-wider text-ink-3">
              Input RMS
            </div>
            <div className="mt-1 text-lg text-ink-1">{inRms.toFixed(3)}</div>
          </div>
          <div className="rounded-lg bg-surface-3 p-3">
            <div className="text-xs uppercase tracking-wider text-ink-3">
              Output RMS
            </div>
            <div className="mt-1 text-lg text-success">{outRms.toFixed(3)}</div>
          </div>
          <div className="rounded-lg bg-surface-3 p-3">
            <div className="text-xs uppercase tracking-wider text-ink-3">
              VAD
            </div>
            <UiBar value={vad} threshold={0.5} height={6} className="mt-2" />
          </div>
        </div>
      </div>

      {/* Generated panel from the real spec (ADR-025 §3). The controller wires
          spec params to the engine; proving spec -> panel -> engine end-to-end. */}
      <div className="mt-8 border-t border-line pt-6">
        <div className="mb-2 text-xs uppercase tracking-wider text-ink-3">
          Spec-driven generated panel
        </div>
        <RnnoiseGeneratedPanel controller={generatedController} />
      </div>
    </section>
  )
}
