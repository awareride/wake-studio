import { memo, useState } from 'react'

/**
 * Traditional KWS Training panel (docs/kws-categories.md §4.2).
 *
 * Traditional Fixed-Class KWS is the only category with a training panel
 * (§2.1: full train + infer). This panel exposes the §4.2 Primary + Advanced
 * parameter sets. Actual training runs on a Phase-5 backend (self-hosted /
 * cloud / Colab, ADR-013/023) — this UI is the parameter surface and a
 * readiness/stub indicator. It is intentionally decoupled: adding real training
 * later means wiring a backend, not reworking this panel.
 */

const DEFAULT_KEYWORDS = 'hey buddy\nhey jarvis\nweather'

export const TrainingPanel = memo(function TrainingPanel() {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS)
  const [architecture, setArchitecture] = useState('micro-wake-word')
  const [epochs, setEpochs] = useState(50)
  const [batchSize, setBatchSize] = useState(32)
  const [lr, setLr] = useState(0.001)
  const [augment, setAugment] = useState(true)
  const [quantize, setQuantize] = useState(true)
  const [earlyStop, setEarlyStop] = useState(true)
  const [ghAction, setGhAction] = useState(false)

  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">
          Traditional KWS — Training
        </h2>
        <p className="text-sm text-slate-400">
          Train a fixed-class wake-word model (§4.2). New keywords require a full
          retrain; supports quantization + export to TFLite / ONNX. Training runs
          on a Phase-5 backend (self-hosted / cloud / Colab, ADR-013/023) — this
          panel collects the parameters.
        </p>
      </div>

      <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">
          Configuration{' '}
          <span className="text-xs font-normal text-slate-500">(Primary)</span>
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Dataset import</span>
            <input
              type="file"
              multiple
              accept=".wav,.zip"
              className="rounded bg-slate-800/80 px-2 py-1 text-slate-300"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Network architecture</span>
            <select
              value={architecture}
              onChange={(e) => setArchitecture(e.target.value)}
              className="rounded bg-slate-800/80 px-2 py-1 text-slate-200"
            >
              <option value="micro-wake-word">micro-wake-word (MCU)</option>
              <option value="ml-kws-mcu">ARM-software/ML-KWS-for-MCU</option>
              <option value="torchkws">swagshaw/TorchKWS</option>
              <option value="openwakeword">openWakeWord (Linux)</option>
            </select>
          </label>
          <label className="flex items-center gap-3 whitespace-nowrap text-sm">
            <span className="w-32 shrink-0 text-slate-400">Epochs</span>
            <input
              type="number"
              min={1}
              max={500}
              value={epochs}
              onChange={(e) => setEpochs(Number(e.target.value))}
              className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-200"
            />
          </label>
          <label className="flex items-center gap-3 whitespace-nowrap text-sm">
            <span className="w-32 shrink-0 text-slate-400">Batch size</span>
            <input
              type="number"
              min={1}
              max={256}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-200"
            />
          </label>
          <label className="flex items-center gap-3 whitespace-nowrap text-sm">
            <span className="w-32 shrink-0 text-slate-400">Learning rate</span>
            <input
              type="number"
              min={0.0001}
              max={0.1}
              step={0.0001}
              value={lr}
              onChange={(e) => setLr(Number(e.target.value))}
              className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Target keyword list</span>
            <textarea
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              rows={3}
              className="rounded bg-slate-800/80 px-2 py-1 text-slate-200"
              placeholder="one keyword per line"
            />
          </label>
        </div>

        <div className="mt-4 border-t border-white/10 pt-3">
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-xs font-medium text-slate-400 hover:text-slate-200"
          >
            {advancedOpen ? '▾' : '▸'} Advanced
          </button>
          {advancedOpen && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 text-slate-400">
                  Audio augmentation
                </span>
                <input
                  type="checkbox"
                  checked={augment}
                  onChange={(e) => setAugment(e.target.checked)}
                  className="accent-brand-400"
                />
              </label>
              <label className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 text-slate-400">
                  Optimizer / scheduler
                </span>
                <select
                  defaultValue="adamw"
                  className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-200"
                >
                  <option value="adamw">AdamW</option>
                  <option value="sgd">SGD + cosine</option>
                </select>
              </label>
              <label className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 text-slate-400">
                  Quantization export
                </span>
                <input
                  type="checkbox"
                  checked={quantize}
                  onChange={(e) => setQuantize(e.target.checked)}
                  className="accent-brand-400"
                />
                <span className="text-xs text-slate-500">TFLite / ONNX int8</span>
              </label>
              <label className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 text-slate-400">Early stopping</span>
                <input
                  type="checkbox"
                  checked={earlyStop}
                  onChange={(e) => setEarlyStop(e.target.checked)}
                  className="accent-brand-400"
                />
              </label>
              <label className="flex items-center gap-3 text-sm sm:col-span-2">
                <span className="w-40 shrink-0 text-slate-400">
                  GitHub Action cloud conversion
                </span>
                <input
                  type="checkbox"
                  checked={ghAction}
                  onChange={(e) => setGhAction(e.target.checked)}
                  className="accent-brand-400"
                />
                <span className="text-xs text-slate-500">
                  build + export on push
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            disabled
            className="cursor-not-allowed rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-400"
            title="Training backend lands in Phase 5 (ADR-013/023). UI ready; execution reserved."
          >
            Start training
          </button>
          <span className="text-xs text-amber-300/80">
            Reserved — training backend arrives in Phase 5.
          </span>
        </div>
      </div>
    </section>
  )
})
