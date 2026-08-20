/**
 * Datasets — generation wizard, full panel of the Datasets view (ADR-044
 * §8, #208).
 *
 * Four steps: choose TTS engine → configure (phrases + name + the engine's
 * OWN params, rendered spec-driven like the Training wizard) → save
 * destination (the §8.1 executor decision: browser vs backend, chosen from
 * engine `runtime` + studio-backend connectivity) → ready/Generate.
 *
 * Submitting runs the job on the chosen executor:
 *   - backend  -> POST /jobs (moduleId dataset-generate); the console opens
 *     the job in the rail with live NDJSON progress (reused Training UI).
 *   - browser  -> the browser executor generates the canonical zip
 *     client-side, saves it to the browser-local store (+ optional direct
 *     Hugging Face push); the console opens the job details too.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@radix-ui/themes'
import { trainPanelSpec } from '@wake-studio/module-training'
import { TrainParamsPanel } from '@wake-studio/module-training/web'
import { resolveExecutor, type GenerationExecutor } from '../executor'
import { fetchDatasetEngines, findDatasetEngine } from '../engines'
import type { TTSEngineDescriptor } from '@wake-studio/module-dataset'
import { cn } from '../../components/cn'
import { IconChevronRight } from '../../components/icons'
import { useAppSettings } from '../../settings'
import { ConfirmDialog } from '../../training/console/ConfirmDialog'
import type { BrowserCloudSave, SubmitGenerateInput } from '../useDatasetJobs'

type WizardStep = 'engine' | 'config' | 'destination' | 'ready'

const STEPS: ReadonlyArray<{ id: WizardStep; label: string; summary: string }> = [
  { id: 'engine', label: 'Engine', summary: 'Pick the TTS engine that synthesizes the audio.' },
  { id: 'config', label: 'Configure', summary: 'Wake phrases + the engine’s own settings.' },
  { id: 'destination', label: 'Destination', summary: 'Where the dataset is generated + saved.' },
  { id: 'ready', label: 'Ready', summary: 'Review and start the generation job.' },
]

const POSTPROCESS_OPTIONS: ReadonlyArray<{ value: string; label: string; note: string }> = [
  { value: 'passthrough', label: 'Passthrough', note: 'Use the synthesized clips as-is.' },
  {
    value: 'openwakeword-style',
    label: 'openWakeWord-style',
    note: 'Pitch/rate/volume perturbation (backend, ffmpeg) — browser runs use passthrough.',
  },
]

export interface NewDatasetWizardProps {
  /** True when a studio-backend is connected (Backends menu) — drives the
   *  executor decision (engine runtime + connectivity, §8.1). */
  backendConnected: boolean
  /** The console owns the job submit (it holds the backend client): it runs
   *  the finalized input via useDatasetJobs and opens the job in the rail. */
  onGenerate: (input: SubmitGenerateInput) => void
  onCancel: () => void
  /** Notified when the wizard gains/loses unsaved progress (nav guard). */
  onDirtyChange?: (dirty: boolean) => void
}

export function NewDatasetWizard({
  backendConnected,
  onGenerate,
  onCancel,
  onDirtyChange,
}: NewDatasetWizardProps) {
  const { platform } = useAppSettings()
  const [step, setStep] = useState<WizardStep>('engine')
  const [engines, setEngines] = useState<TTSEngineDescriptor[]>([])
  const [engineError, setEngineError] = useState<string | null>(null)
  const [engineId, setEngineId] = useState<string | null>(null)
  const [phrases, setPhrases] = useState('')
  const [name, setName] = useState('')
  const [postprocess, setPostprocess] = useState('passthrough')
  const [engineParams, setEngineParams] = useState<Record<string, string>>({})
  const [cloudRepo, setCloudRepo] = useState('')
  const [starting, setStarting] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchDatasetEngines().then(({ engines: e, error }) => {
      if (cancelled) return
      setEngines(e)
      setEngineError(error)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const engine = findDatasetEngine(engines, engineId ?? undefined)
  const hfToken = platform['cloud.hf.token'] ?? ''
  const decision = engine ? resolveExecutor(engine, backendConnected) : null

  const phraseList = useMemo(
    () => phrases.split(/\n|,/).map((s) => s.trim()).filter(Boolean),
    [phrases],
  )

  const dirty = step !== 'engine' || engineId !== null || phrases !== ''
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // The engine's own params rendered spec-driven (ADR-025) — reset when the
  // engine changes so stale values from a previous engine never leak in.
  const enginePanelSpec = useMemo(() => {
    if (!engine) return null
    return trainPanelSpec({
      id: engine.id,
      name: engine.name,
      category: 'data',
      license: engine.provenanceTemplate?.license ?? 'user-owned',
      params: engine.params as unknown as NonNullable<Parameters<typeof trainPanelSpec>[0]['params']>,
    })
  }, [engine])

  const selectEngine = useCallback((id: string) => {
    setEngineId(id)
    setEngineParams({})
  }, [])

  const stepIndex = STEPS.findIndex((s) => s.id === step)
  const canNext =
    step === 'engine'
      ? engine !== null
      : step === 'config'
        ? phraseList.length > 0
        : step === 'destination'
          ? decision?.executor !== null
          : true

  const goNext = useCallback(() => {
    setStep(() => STEPS[Math.min(stepIndex + 1, STEPS.length - 1)].id)
  }, [stepIndex])

  const goBack = useCallback(() => {
    setStep((s) => (stepIndex > 0 ? STEPS[stepIndex - 1].id : s))
  }, [stepIndex])

  // Assemble the job params in the registry format (GEN_* env keys).
  const jobParams = useMemo<Record<string, string>>(() => {
    return {
      engine: engine?.id ?? '',
      phrases: phraseList.join(','),
      ...(name.trim() ? { name: name.trim() } : {}),
      languages: engineParams.languages ?? 'en-US',
      samplesPerPhrase: engineParams.samplesPerPhrase ?? '3',
      unknownWords: engineParams.unknownWords ?? 'goodbye,okay,stop,hello,thanks',
      postprocess,
      sampleRate: '16000',
      ...engineParams,
    }
  }, [engine, phraseList, name, engineParams, postprocess])

  const cloudSave: BrowserCloudSave | undefined = useMemo(() => {
    if (decision?.executor !== 'browser') return undefined
    if (!cloudRepo.trim() || !hfToken) return undefined
    return { repoId: cloudRepo.trim(), token: hfToken }
  }, [decision, cloudRepo, hfToken])

  const requestCancel = useCallback(() => {
    if (dirty) setConfirmCancel(true)
    else onCancel()
  }, [dirty, onCancel])

  const handleGenerate = useCallback(() => {
    if (!engine || !decision?.executor || starting) return
    setStarting(true)
    const executor = decision.executor as GenerationExecutor
    const input: SubmitGenerateInput = {
      moduleId: 'dataset-generate',
      executor,
      params: jobParams,
      ...(executor === 'browser' && cloudSave ? { cloud: cloudSave } : {}),
    }
    // The console runs the job (it holds the backend client) and opens its
    // details in the rail; the wizard itself closes (see handleStarted).
    onGenerate(input)
  }, [engine, decision, starting, jobParams, cloudSave, onGenerate])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header + Cancel. */}
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-1">New generation task</h3>
          <p className="mt-0.5 text-xs text-ink-3">
            {STEPS[stepIndex]?.summary} Generation jobs land in the Datasets rail with live
            progress (same UI as Training).
          </p>
        </div>
        <Button type="button" onClick={requestCancel} variant="outline" size="1" className="text-xs">
          Cancel
        </Button>
      </div>

      {/* Step pills. */}
      <nav aria-label="Generation steps" className="flex shrink-0 flex-wrap items-center gap-1.5">
        {STEPS.map((s, i) => {
          const active = s.id === step
          const done = stepIndex > i
          return (
            <div key={s.id} className="flex items-center gap-1.5">
              {i > 0 && <IconChevronRight className="h-3.5 w-3.5 text-ink-3" />}
              <span
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
                  active
                    ? 'border-brand-9/60 bg-brand-9/10 text-brand-11'
                    : done
                      ? 'border-line bg-surface-2 text-ink-2'
                      : 'border-line bg-surface-1 text-ink-3',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                    active
                      ? 'bg-brand-9 text-ink-1'
                      : done
                        ? 'bg-success/20 text-success'
                        : 'bg-surface-3 text-ink-3',
                  )}
                >
                  {done ? '✓' : i + 1}
                </span>
                {s.label}
              </span>
            </div>
          )
        })}
      </nav>

      {/* Content. */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        {step === 'engine' && (
          <EngineStep
            engines={engines}
            selectedId={engineId}
            onSelect={selectEngine}
            backendConnected={backendConnected}
            error={engineError}
          />
        )}

        {step === 'config' && engine && (
          <div className="space-y-5">
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <h4 className="text-sm font-semibold text-ink-1">Wake phrases</h4>
              <p className="mt-0.5 text-xs text-ink-3">
                One wake phrase per line (or comma-separated). Each phrase becomes a{' '}
                <span className="font-mono">positive</span> label.
              </p>
              <textarea
                value={phrases}
                onChange={(e) => setPhrases(e.target.value)}
                rows={3}
                placeholder={'hey studio\ngood morning'}
                className="mt-2 w-full rounded-lg border border-line bg-surface-1 px-3 py-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-8"
              />
              {phraseList.length > 0 && (
                <p className="mt-1 text-[11px] text-ink-3">
                  {phraseList.length} phrase(s): {phraseList.join(', ')}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <h4 className="text-sm font-semibold text-ink-1">Dataset name</h4>
              <p className="mt-0.5 text-xs text-ink-3">
                Optional — defaults to the first phrase + languages.
              </p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="wake-words-zh-en"
                className="mt-2 w-full rounded-lg border border-line bg-surface-1 px-3 py-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-8"
              />
            </div>

            {enginePanelSpec && (
              <div className="rounded-xl border border-line bg-surface-2 p-4">
                <h4 className="text-sm font-semibold text-ink-1">
                  {engine.name} settings
                </h4>
                <p className="mt-0.5 text-xs text-ink-3">
                  The engine’s own parameters (rendered spec-driven, ADR-025).
                </p>
                <div className="mt-3">
                  <TrainParamsPanel
                    spec={enginePanelSpec}
                    onValuesChange={(values) => setEngineParams(values)}
                  />
                </div>
              </div>
            )}

            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <h4 className="text-sm font-semibold text-ink-1">Postprocess</h4>
              <p className="mt-0.5 text-xs text-ink-3">
                An optional transform applied to the synthesized clips.
              </p>
              <div className="mt-2 space-y-1.5">
                {POSTPROCESS_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                      postprocess === o.value
                        ? 'border-brand-9/60 bg-brand-9/10'
                        : 'border-line bg-surface-3 hover:border-ink-4',
                    )}
                  >
                    <input
                      type="radio"
                      className="mt-0.5 accent-[var(--brand-9)]"
                      checked={postprocess === o.value}
                      onChange={() => setPostprocess(o.value)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink-1">{o.label}</span>
                      <span className="block text-[11px] leading-relaxed text-ink-3">{o.note}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'destination' && engine && decision && (
          <DestinationStep
            decisionExecutor={decision.executor}
            unavailable={decision.unavailable}
            note={decision.note}
            backendConnected={backendConnected}
            cloudRepo={cloudRepo}
            onCloudRepoChange={setCloudRepo}
            hfTokenPresent={!!hfToken}
          />
        )}

        {step === 'ready' && engine && decision?.executor && (
          <div className="space-y-4">
            <ReadySummary
              engine={engine}
              executor={decision.executor}
              phraseList={phraseList}
              name={name}
              postprocess={postprocess}
              cloudRepo={decision.executor === 'browser' ? cloudRepo : ''}
            />
          </div>
        )}
      </div>

      {/* Footer. */}
      <div className="shrink-0 space-y-2 border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <Button type="button" onClick={goBack} disabled={stepIndex === 0} variant="outline" size="2">
            Back
          </Button>
          {step !== 'ready' ? (
            <Button type="button" onClick={goNext} disabled={!canNext} size="2">
              Next
            </Button>
          ) : (
            <Button type="button" onClick={handleGenerate} disabled={starting} size="2" className="font-semibold">
              {starting ? 'Starting…' : 'Generate dataset'}
            </Button>
          )}
        </div>
        {step === 'ready' && decision?.executor === 'browser' && (
          <p className="text-[11px] leading-relaxed text-ink-3">
            Runs entirely in this tab (online HTTP TTS → canonical zip). The dataset is saved to
            the browser-local store; no studio-backend is involved.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Discard this generation?"
        message="You have progress in the wizard. Leaving now discards your selections."
        confirmLabel="Discard"
        onConfirm={() => {
          setConfirmCancel(false)
          onCancel()
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step content
// ---------------------------------------------------------------------------

function EngineStep({
  engines,
  selectedId,
  onSelect,
  backendConnected,
  error,
}: {
  engines: TTSEngineDescriptor[]
  selectedId: string | null
  onSelect: (id: string) => void
  backendConnected: boolean
  error: string | null
}) {
  if (error) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-xs text-danger">
        Could not load the TTS engine catalog: {error}
      </div>
    )
  }
  if (engines.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface-2 p-8 text-center text-sm text-ink-2">
        Loading engines…
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {engines.map((e) => {
        const decision = resolveExecutor(e, backendConnected)
        const available = decision.executor !== null
        const selected = e.id === selectedId
        return (
          <label
            key={e.id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
              available
                ? selected
                  ? 'border-brand-9/60 bg-brand-9/10'
                  : 'border-line bg-surface-2 hover:border-ink-4'
                : 'cursor-not-allowed border-line bg-surface-2 opacity-60',
            )}
          >
            <input
              type="radio"
              className="mt-1 accent-[var(--brand-9)]"
              checked={selected}
              disabled={!available}
              onChange={() => onSelect(e.id)}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium text-ink-1">{e.name}</span>
                <span className="rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                  {e.id}
                </span>
                <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                  {e.kind}
                </span>
                {e.runtime.map((r) => (
                  <span
                    key={r}
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
                      r === 'browser' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-sky-500/10 text-sky-700',
                    )}
                  >
                    {r}
                  </span>
                ))}
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-ink-3">
                {available ? decision.note : decision.unavailable}
              </span>
            </span>
          </label>
        )
      })}
      {!backendConnected && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-700">
          No studio-backend connected — browser-capable engines (green “browser” badge) run
          client-side; backend-only engines are disabled until you connect one in the Backends
          menu.
        </p>
      )}
    </div>
  )
}

function DestinationStep({
  decisionExecutor,
  unavailable,
  note,
  backendConnected,
  cloudRepo,
  onCloudRepoChange,
  hfTokenPresent,
}: {
  decisionExecutor: GenerationExecutor | null
  unavailable?: string
  note: string
  backendConnected: boolean
  cloudRepo: string
  onCloudRepoChange: (v: string) => void
  hfTokenPresent: boolean
}) {
  if (!decisionExecutor) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-xs leading-relaxed text-danger">
        {unavailable ?? 'No executor is available for this engine.'}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Executor</h4>
        <div
          className={cn(
            'mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed',
            decisionExecutor === 'backend'
              ? 'border-brand-8/30 bg-brand-8/5'
              : 'border-emerald-500/30 bg-emerald-500/5',
          )}
        >
          <span className="font-medium text-ink-1">
            {decisionExecutor === 'backend' ? 'Backend executor' : 'Browser executor'}
          </span>
          <span className="ml-2 text-ink-3">{note}</span>
        </div>
      </div>

      {decisionExecutor === 'backend' && (
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Save destination</h4>
          <p className="mt-2 text-xs leading-relaxed text-ink-2">
            The generated dataset is persisted to the connected studio-backend’s{' '}
            <span className="font-mono">datasets/</span> store — it becomes trainable and
            downloadable. Cloud upload (Hugging Face / R2 / Drive) is available as an action on
            the dataset after generation.
          </p>
        </div>
      )}

      {decisionExecutor === 'browser' && (
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Save destination</h4>
          <p className="mt-2 text-xs leading-relaxed text-ink-2">
            Saved to the <span className="font-medium text-ink-1">browser-local store</span> (this
            tab’s IndexedDB) — it shows in the Datasets rail and the Training dataset picker.
          </p>
          <div className="mt-3 space-y-1.5">
            <label
              htmlFor="hf-repo"
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface-3 px-3 py-2"
            >
              <input
                id="hf-repo"
                type="checkbox"
                className="mt-0.5 accent-[var(--brand-9)]"
                checked={!!cloudRepo}
                onChange={(e) => !e.target.checked && onCloudRepoChange('')}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-1">
                  Also push to Hugging Face{' '}
                  <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700">
                    browser direct push
                  </span>
                </span>
                <span className="block text-[11px] leading-relaxed text-ink-3">
                  {hfTokenPresent
                    ? 'Uploads wake-studio-dataset.zip straight to a dataset repo using your Settings cloud token (R2 / Drive are not wired browser-side yet).'
                    : 'Set a Hugging Face token in Settings → Cloud storage first.'}
                </span>
              </span>
            </label>
            {cloudRepo && (
              <input
                value={cloudRepo}
                onChange={(e) => onCloudRepoChange(e.target.value)}
                placeholder="your-user/wake-words-zh-en"
                className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-8"
              />
            )}
          </div>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-ink-3">
        Executor decided by the engine’s <span className="font-mono">runtime</span> + whether a
        studio-backend is connected ({backendConnected ? 'connected' : 'not connected'}).
      </p>
    </div>
  )
}

function ReadySummary({
  engine,
  executor,
  phraseList,
  name,
  postprocess,
  cloudRepo,
}: {
  engine: TTSEngineDescriptor
  executor: GenerationExecutor
  phraseList: string[]
  name: string
  postprocess: string
  cloudRepo: string
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Review</h4>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          <SummaryRow label="Engine" value={`${engine.name} (${engine.id})`} />
          <SummaryRow label="Executor" value={executor === 'backend' ? 'studio-backend' : 'browser'} />
          <SummaryRow label="Phrases" value={phraseList.join(', ') || '—'} />
          <SummaryRow label="Name" value={name || '(auto)'} />
          <SummaryRow label="Postprocess" value={postprocess} />
          {executor === 'browser' && <SummaryRow label="Cloud push" value={cloudRepo || 'local only'} />}
        </dl>
      </div>
      <p className="text-xs leading-relaxed text-ink-2">
        License: <span className="font-medium text-ink-1">user-owned (synthetic TTS)</span> — the
        generated dataset is commercially usable and trains clean models (export gate, #210).
      </p>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="truncate font-mono text-ink-1" title={value}>
        {value}
      </dd>
    </div>
  )
}

