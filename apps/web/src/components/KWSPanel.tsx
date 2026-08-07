/**
 * KWS detection panel (live DSP orchestration, not spec-driven).
 *
 * The KWS stage's params/actions/status surface is declared in the module
 * specs (kws-engine `describeParameters()`, per-driver specs carried on the
 * backend registration); this panel is the LIVE orchestration layer on top
 * of the engine: boot/load/start/stop, AFE stream wiring, score curve and
 * trigger flash. Model locations come from the platform model registry
 * (ADR-011/027), never hard-coded here.
 *
 * The driver-specific config panel is rendered from the selected backend's
 * registration spec (ADR-025) - adding a driver never edits this file.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import type { PanelCommands } from '../workspace/usePipelineRunner'
import {
  KWSEngine,
  DEFAULT_CONFIG,
  describeParameters,
  getBackendRegistry,
} from '@wake-studio/module-kws-engine'
import type {
  BackendModelUrls,
  KWSConfig,
  KWSScoreSample,
  KWSTriggerEvent,
  KWSStatus,
} from '@wake-studio/module-kws-engine'
import { MEL_WINDOW_SIZE } from '@wake-studio/module-kws-engine'
import { loadRegistry, type ModelRegistry } from '@wake-studio/platform'
import {
  TRADITIONAL_MODEL_ROLES,
  FEWSHOT_MODEL_ROLES,
  driverParamsFor,
  modelSourcesForRole,
} from '../workspace/kws-config'
import { UnifiedConfigPanel, ParamRows, type ParamValue } from './UnifiedConfigPanel'
import { drawScoreCurve } from './viz/ScoreCurve'
import { useProjectStageConfig } from '../projects'
import { useLiveKws } from '../workspace/live'
import { useAppSettings } from '../settings/context'
import { loadModuleSettings, saveModuleSettings } from '../settings/storage'
import { logTrigger, logInfo, logError } from '../log'
// Few-Shot enrollment (plixkws branch): the engine is the headless
// enrollment/prototype layer (ADR-013 amendment - client-side only); the
// recorder worklet URL comes from the few-shot module's web target.
import {
  FewShotEngine,
  DEFAULT_CONFIG as FS_DEFAULTS,
  describeParameters as fewShotDescribeParameters,
} from '@wake-studio/module-few-shot'
import type { EnrolledSample, WakeWordPrototype } from '@wake-studio/module-few-shot'
import { recorderWorkletUrl as recorderUrl } from '@wake-studio/module-few-shot/web'
import { getPlixEncoderVariant } from '@wake-studio/module-kws-plix/encoders/plix-encoder'
import {
  importModelFile,
  listUserModels,
  deleteUserModel,
  exportUserModel,
  blobUrlForModel,
} from '../model-library'
import type { UserModel } from '../model-library'

const HISTORY_MAX = 300 // ~3 s at ~100 fps

// plixkws enrollment constants (mirrors the removed Few-Shot panel).
const RECORD_MS = 1500
const MIN_SAMPLES = 3

/**
 * Resource descriptors shown in the Engine card, per backend. Each row is one
 * thing the engine loads or one piece of persistent data the user has created
 * (enrolled samples, wake-word lists). 'model' rows resolve their URL from the
 * platform registry (ADR-011); 'data' rows come from IndexedDB / driver params.
 */
interface EngineResource {
  id: string
  label: string
  kind: 'model' | 'data'
  /** key into BackendModelUrls (kind: 'model'). */
  urlKey?: keyof BackendModelUrls
  /** Detail shown under the label (e.g. URL, sample count). */
  detail?: string
}

/**
 * Static resource map per backend category. Model rows resolve their URL from
 * the engine's loaded URLs (ADR-011); 'ready' flips when the backend reports
 * loaded. 'data' rows show persisted artifacts (IndexedDB / driver params).
 */
const ENGINE_RESOURCES: Record<string, EngineResource[]> = {
  traditional: [
    { id: 'melspectrogram', label: 'Mel-spectrogram front-end', kind: 'model', urlKey: 'melspectrogram' },
    { id: 'embedding', label: 'Speech embedding backbone', kind: 'model', urlKey: 'embedding' },
    { id: 'classifier', label: 'Wake-word classifier', kind: 'model', urlKey: 'classifier' },
  ],
  'asr-decoding': [
    { id: 'wasm', label: 'sherpa-onnx KWS wasm runtime', kind: 'model' },
    { id: 'keywords', label: 'Wake-word list', kind: 'data' },
  ],
  'few-shot': [
    { id: 'encoder', label: 'PLiX encoder', kind: 'model', urlKey: 'plixkws' },
    { id: 'prototypes', label: 'Enrolled prototypes', kind: 'data' },
    { id: 'samples', label: 'Enrolled samples', kind: 'data' },
  ],
}

interface Props {
  afePipeline: AFEPipeline | null
  afeRunning: boolean
  /**
   * Optional: external control (workspace pipeline runner) to load / start /
   * stop detection (epic #53 P4). getState lets the runner read the current
   * KWS status without owning the state.
   */
  commandRef?: MutableRefObject<PanelCommands | null>
  /**
   * Optional: report a compact config summary (e.g. "openwakeword · ready")
   * for the KWS tab node's core preview (epic #53 UX overhaul).
   */
  onPreview?: (preview: string) => void
  /**
   * Optional: when true, skip the panel's own heading + description (the
   * workspace renders it inside the KWS stage shell).
   */
  embedded?: boolean
}

export const KWSPanel = memo(function KWSPanel({
  afePipeline,
  afeRunning,
  commandRef,
  onPreview,
  embedded,
}: Props) {
  const engineRef = useRef<KWSEngine | null>(null)
  const [status, setStatus] = useState<KWSStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [triggerFlash, setTriggerFlash] = useState(false)
  const [warmup, setWarmup] = useState(false)
  // Seed config from the active project's KWS snapshot (falls back to defaults).
  const { projectConfig: projCfg, persist } = useProjectStageConfig('kws')
  const { kwsSources, setKwsSources } = useAppSettings()
  const [config, setConfig] = useState<KWSConfig>({
    ...DEFAULT_CONFIG,
    ...(projCfg as Partial<KWSConfig> | undefined),
  })
  const [executionProvider, setExecutionProvider] = useState<'webgpu' | 'wasm'>(
    'wasm',
  )
  const [lastKeyword, setLastKeyword] = useState('')

  // --- plixkws enrollment state (Few-Shot, Phase 3) ---
  const fsEngineRef = useRef<FewShotEngine | null>(null)
  const [samples, setSamples] = useState<EnrolledSample[]>([])
  const [recording, setRecording] = useState(false)
  const [building, setBuilding] = useState(false)
  const [prototype, setPrototype] = useState<WakeWordPrototype | null>(null)
  const [detecting, setDetecting] = useState(false)
  const { projectConfig: fsProjCfg, persist: persistFs } = useProjectStageConfig('fewShot')
  const [fsConfig, setFsConfig] = useState<{
    threshold: number
    minDurationMs: number
    cooldownMs: number
    smoothingWindowFrames: number
    vadGateEnabled: boolean
    vadThreshold: number
    windowMs: number
    hopMs: number
    useNegativePrototype: boolean
  }>({
    ...FS_DEFAULTS,
    ...(fsProjCfg as Partial<typeof FS_DEFAULTS> | undefined),
  })
  const fsCanvasRef = useRef<HTMLCanvasElement>(null)
  const fsHistoryRef = useRef<KWSScoreSample[]>([])
  // Persisted few-shot artifacts (IndexedDB, ADR-013): shown in the Engine
  // card's resource list so previously-enrolled data is visible on load.
  const [savedPrototypes, setSavedPrototypes] = useState<WakeWordPrototype[]>([])
  const [savedSampleCount, setSavedSampleCount] = useState(0)

  const { historyRef, setThreshold, setLastScore } = useLiveKws()

  // Report a compact config summary for the tab node's core preview (the
  // few-shot flag is resolved below; backend + status are enough here).
  useEffect(() => {
    onPreview?.(`${config.backend} · ${status === 'idle' ? 'idle' : status}`)
  }, [config.backend, status, onPreview])
  // Registry-loaded model URLs (lazy; resolved at load time, ADR-011).
  const urlsRef = useRef<BackendModelUrls>({})
  // User-selectable model sources per role (ModelSourceEditor). Keyed by
  // role; value is the selected registry id or 'custom' (URL follows).
  // Defaults to undefined -> the built-in registry URL is used.
  // Persistence (#52/#53): seeded from the app-level kwsSources defaults
  // (localStorage); the #53 WorkspaceConfig project snapshot will override
  // per project when it lands. Writes persist to app defaults.
  const [modelSources, setModelSources] = useState<Record<string, string | undefined>>(
    () => ({ ...(kwsSources.modelSources ?? {}) }),
  )
  const [customUrls, setCustomUrls] = useState<Record<string, string>>(
    () => ({ ...(kwsSources.customUrls ?? {}) }),
  )
  // Persist edits to app-level defaults on change (#52/#53). Skipped on
  // first mount (initial values already come from kwsSources).
  const firstRenderRef = useRef(true)
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }
    setKwsSources({ modelSources, customUrls })
  }, [modelSources, customUrls, setKwsSources])
  // The loaded registry (for the selector options); loaded lazily on demand.
  const [registryModels, setRegistryModels] = useState<ModelRegistry | null>(null)
  // User model library (IndexedDB): local-file imports and future training
  // artifacts. Listed in the Model-source editor; exportable back to disk.
  const [userModels, setUserModels] = useState<UserModel[]>([])
  // Object URLs for selected user models (role -> blob URL). Created when a
  // saved model is chosen, so the backend can fetch() it.
  const userBlobUrlRef = useRef<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Preload the model registry on mount so the Model-source editor shows the
  // built-in candidates immediately (the registry JSON is local, ADR-011).
  useEffect(() => {
    let cancelled = false
    void loadRegistry()
      .then((r) => {
        if (!cancelled) setRegistryModels(r)
      })
      .catch(() => {
        // Registry unreachable - the editor shows the built-in placeholder;
        // Load will surface the real error.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Load the user model library (IndexedDB) on mount.
  useEffect(() => {
    let cancelled = false
    void listUserModels()
      .then((models) => {
        if (!cancelled) setUserModels(models)
      })
      .catch(() => {
        // IndexedDB unavailable - the editor just shows no saved models.
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Import a local model file into the user model library for a role. */
  const handleImportModelFile = useCallback(
    async (file: File | undefined, role: UserModel['role']) => {
      if (!file) return
      try {
        const model = await importModelFile(file, role, `Imported from ${file.name}`)
        setUserModels((prev) => [model, ...prev])
        // Auto-select the freshly imported model for this role.
        setModelSources((prev) => ({ ...prev, [role]: `user:${model.id}` }))
        const url = await blobUrlForModel(model.id)
        if (url) userBlobUrlRef.current[role] = url
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [],
  )

  /** Select a saved user model for a role; resolves its blob URL. */
  const handleSelectUserModel = useCallback(
    async (role: UserModel['role'], modelId: string) => {
      setModelSources((prev) => ({ ...prev, [role]: `user:${modelId}` }))
      const url = await blobUrlForModel(modelId)
      if (url) {
        userBlobUrlRef.current[role] = url
      } else {
        setError(`Saved model ${modelId} not found in the library.`)
      }
    },
    [],
  )
  // The selected backend's own params, from its registration spec (ADR-025).
  // Empty when the backend carries no spec (no driver config panel).
  const driverParams = driverParamsFor(config.backend)
  // Editable driver param values, seeded from the app-level module defaults
  // (#52) + the active project's snapshot override (#53 P1 layered
  // persistence), falling back to the spec defaults. Edited via the config
  // panel, then passed to engine.load on the next Load.
  const appDriverDefaults = useMemo(() => {
    const all = loadModuleSettings()
    return (all[config.backend] as Record<string, unknown>) ?? {}
  }, [config.backend])
  const [driverValues, setDriverValues] = useState<Record<string, ParamValue>>(
    () => {
      const specDefaults = Object.fromEntries(
        driverParamsFor(config.backend).map((p) => [p.id, p.default]),
      )
      // Layer order: spec defaults < app module defaults (#52). The #53
      // WorkspaceConfig project-snapshot override lands with that epic.
      return {
        ...specDefaults,
        ...appDriverDefaults,
      } as Record<string, ParamValue>
    },
  )

  // Reset driver param values when the backend changes (each driver's spec
  // has its own params; stale values from another backend must not leak).
  const driverBackendRef = useRef(config.backend)
  useEffect(() => {
    const prev = driverBackendRef.current
    driverBackendRef.current = config.backend
    if (prev === config.backend) return
    const specDefaults = Object.fromEntries(
      driverParamsFor(config.backend).map((p) => [p.id, p.default]),
    )
    const appDefaults = (loadModuleSettings()[config.backend] as
      | Record<string, unknown>
      | undefined) ?? {}
    setDriverValues({
      ...specDefaults,
      ...appDefaults,
    } as Record<string, ParamValue>)
  }, [config.backend])

  // Persist driver param edits to app-level module defaults on change (#52).
  // Skipped on first render + backend-switch resets (those set spec defaults).
  const driverFirstRef = useRef(true)
  useEffect(() => {
    if (driverFirstRef.current) {
      driverFirstRef.current = false
      return
    }
    if (Object.keys(driverValues).length > 0) {
      saveModuleSettings(config.backend, { ...driverValues })
    }
  }, [driverValues, config.backend])

  const params = describeParameters()

  // plixkws enrollment: encoder variant + runtime are the driver's spec
  // params (ADR-025). Seeded from driverValues (spec defaults) so a future
  // few-shot driver with different options works unchanged.
  const plixVariant =
    (driverValues.encoder as 'base' | 'small' | undefined) ?? 'small'
  const plixRuntime =
    (driverValues.runtime as 'onnx' | 'transformers' | undefined) ?? 'onnx'

  /**
   * Resolve the effective model URL for one role, honoring the user's
   * selection: a registry built-in id or a custom URL. Falls back to the
   * registry default when nothing is selected.
   */
  const resolveModelUrl = useCallback(
    (
      registry: ModelRegistry,
      role: 'melspectrogram' | 'embedding' | 'classifier' | 'plix-encoder',
      fallbackId: string,
    ): string | undefined => {
      const selected = modelSources[role]
      const byId = new Map(registry.models.map((m) => [m.id, m.url]))
      // User-library model: use the pre-resolved blob URL.
      if (selected?.startsWith('user:')) {
        return userBlobUrlRef.current[role]
      }
      if (selected && selected !== 'custom') {
        return byId.get(selected)
      }
      if (selected === 'custom') {
        return customUrls[role]?.trim() || undefined
      }
      // Default: the built-in registry entry for this role.
      return byId.get(fallbackId)
    },
    [modelSources, customUrls],
  )

  const handleLoad = useCallback(async () => {
    setError(null)
    const engine = engineRef.current
    if (!engine) return
    try {
      setStatus('loading')
      // Ensure the engine has the latest backend selection before loading.
      engine.setConfig({ backend: config.backend, threshold: config.threshold })
      // Resolve model URLs from the platform registry (ADR-011) - never
      // hard-coded here; the UI shows the exact fetch command if absent.
      // User-selected model sources (ModelSourceEditor) override the
      // registry defaults: built-in pretrained models or a custom URL (e.g. a
      // model trained with this platform).
      const registry = await loadRegistry()
      setRegistryModels(registry)
      const urls: BackendModelUrls =
        config.backend === 'plixkws'
          ? { plixkws: resolveModelUrl(registry, 'plix-encoder', 'plixkws') }
          : {
              melspectrogram: resolveModelUrl(registry, 'melspectrogram', 'melspectrogram'),
              embedding: resolveModelUrl(registry, 'embedding', 'speech_embedding'),
              classifier: resolveModelUrl(registry, 'classifier', 'hey-buddy'),
            }
      urlsRef.current = urls
      // Pass the driver's edited params as its backend config (unknown to the
      // engine; the driver's configure() interprets them, e.g. sherpa
      // keywords).
      const backendConfig = Object.keys(driverValues).length
        ? (driverValues as Record<string, unknown>)
        : undefined
      await engine.load(urlsRef.current, undefined, backendConfig)
      setStatus(engine.status)
      setExecutionProvider(engine.executionProvider)
      logInfo('kws', `Models loaded (backend: ${config.backend})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
      logError('kws', err instanceof Error ? err.message : String(err))
    }
  }, [config.backend, config.threshold, driverValues, resolveModelUrl])

  // Auto-load: switching the backend selection loads that backend's models
  // automatically (registry is a local JSON, ADR-011). Initial mount keeps the
  // manual Load button (no surprise model fetches on visit); "Reload" re-applies
  const prevBackendRef = useRef(config.backend)
  // The backend's KWS functional category (ADR-024): few-shot backends
  // (plixkws today, future drivers) get the enrollment flow automatically.
  const selectedBackend = getBackendRegistry().find((r) => r.id === config.backend)
  const isFewShot = selectedBackend?.category === 'few-shot'
  // Backend switching is lightweight: it only updates the selection (and any
  // pending load state), it does NOT auto-load models. Loading a different
  // backend re-initializes the worker + model session, which is slow; the user
  // explicitly clicks Load (or Reload) when ready. The few-shot branch never
  // auto-loads either - it runs enrollment first.
  useEffect(() => {
    // Backend changed: reset to idle so the UI shows the load/start controls
    // for the newly selected backend (models for the old backend are
    // discarded). This applies to the few-shot branch too - previously it
    // early-returned, leaving the UI stuck at the old backend's 'ready' state
    // and hiding the plixkws encoder-load button (the switch appeared to do
    // nothing and detection silently failed).
    if (prevBackendRef.current !== config.backend) {
      prevBackendRef.current = config.backend
      setStatus('idle')
      setError(null)
      setRunning(false)
      setDetecting(false)
      // Tear down the old backend session so the stale worker (old backend)
      // does not keep running detection for the previous model.
      engineRef.current?.dispose()
    }
  }, [config.backend, isFewShot])

  // --- plixkws enrollment + detection ---

  /**
   * Resolve the PLiX model locator for the selected variant + runtime.
   * Honors the user's ModelSource selection: a custom encoder URL (e.g. a
   * model trained with this platform) takes precedence over the variant's
   * built-in ONNX URL. The transformers runtime always uses the locally
   * served HF-style dir (variant.transformersLocalDir).
   */
  const resolvePlixLocator = useCallback((): { url: string; runtime: 'onnx' | 'transformers' } => {
    const variant = getPlixEncoderVariant(plixVariant)
    if (!variant) {
      throw new Error(`Unknown PLiX variant: ${plixVariant}`)
    }
    const rt = plixRuntime
    const customUrl = modelSources['plix-encoder'] === 'custom'
      ? customUrls['plix-encoder']?.trim()
      : undefined
    let url: string
    if (rt === 'transformers') {
      url = variant.transformersLocalDir
    } else if (modelSources['plix-encoder']?.startsWith('user:')) {
      // User-library encoder (imported file / training artifact).
      const blobUrl = userBlobUrlRef.current['plix-encoder']
      if (!blobUrl) throw new Error('Selected PLiX encoder is not in the model library.')
      url = blobUrl
    } else if (customUrl) {
      // User-supplied encoder URL overrides the built-in variant asset.
      url = customUrl
    } else {
      url = variant.onnxUrl
    }
    return { url, runtime: rt }
  }, [plixVariant, plixRuntime, modelSources, customUrls])

  const ensureFsEngines = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new KWSEngine()
      engineRef.current.onScore((s) => {
        setLastScore(s.smoothedScore)
        fsHistoryRef.current.push(s)
        if (fsHistoryRef.current.length > HISTORY_MAX) fsHistoryRef.current.shift()
      })
      engineRef.current.onTrigger(() => {
        setTriggerFlash(true)
        setTimeout(() => setTriggerFlash(false), 500)
      })
    }
    if (!fsEngineRef.current) {
      fsEngineRef.current = new FewShotEngine(engineRef.current)
    }
    return engineRef.current
  }, [])

  // Load persisted few-shot artifacts (IndexedDB) on mount + when a new
  // prototype is built, so the Engine card's resource list stays fresh.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        ensureFsEngines()
        const fs = fsEngineRef.current
        if (!fs) return
        const protos = await fs.listPrototypes()
        if (!cancelled) {
          setSavedPrototypes(protos)
          setSavedSampleCount(protos.reduce((acc, p) => acc + p.sampleIds.length, 0))
        }
      } catch {
        // IndexedDB unavailable - ignore; the list stays empty.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [prototype, ensureFsEngines])

  /** Load the PLiX encoder (embed-only, no detection backend yet). */
  const handleLoadEncoder = useCallback(async () => {
    setError(null)
    const engine = ensureFsEngines()
    try {
      setStatus('loading')
      engine.setConfig({ ...DEFAULT_CONFIG, backend: 'openwakeword' })
      const { url, runtime } = resolvePlixLocator()
      await engine.load({ plixkws: url, runtime })
      setStatus(engine.status)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setStatus('error')
    }
  }, [ensureFsEngines, resolvePlixLocator])

  /** Record a 1.5 s sample from the mic at 16 kHz. */
  const handleRecord = useCallback(async () => {
    setError(null)
    setRecording(true)
    let ctx: AudioContext | null = null
    let stream: MediaStream | null = null
    let node: AudioWorkletNode | null = null
    let source: MediaStreamAudioSourceNode | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      ctx = new AudioContext({ sampleRate: 16000 })
      if (ctx.state === 'suspended') await ctx.resume()
      await ctx.audioWorklet.addModule(recorderUrl)

      source = ctx.createMediaStreamSource(stream)
      node = new AudioWorkletNode(ctx, 'few-shot-recorder')
      const chunks: Float32Array[] = []
      node.port.onmessage = (e: MessageEvent<{ type: 'chunk'; samples: Float32Array }>) => {
        if (e.data.type === 'chunk') chunks.push(e.data.samples)
      }
      source.connect(node)
      node.connect(ctx.destination)

      await new Promise((r) => setTimeout(r, RECORD_MS))
      node.disconnect()
      source.disconnect()
      stream.getTracks().forEach((t) => t.stop())

      const total = chunks.reduce((a, c) => a + c.length, 0)
      const audio = new Float32Array(total)
      let off = 0
      for (const c of chunks) {
        audio.set(c, off)
        off += c.length
      }

      ensureFsEngines()
      const sample = await fsEngineRef.current!.embedSample(audio, 16000)
      setSamples((prev) => [...prev, sample])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecording(false)
      try { node?.disconnect() } catch { /* ignore */ }
      try { source?.disconnect() } catch { /* ignore */ }
      stream?.getTracks().forEach((t) => t.stop())
      if (ctx) await ctx.close().catch(() => {})
    }
  }, [ensureFsEngines])

  const handleBuildPrototype = useCallback(async () => {
    setError(null)
    setBuilding(true)
    try {
      const fs = fsEngineRef.current!
      const proto = fs.buildPrototype('custom-word', samples)
      await fs.savePrototype(proto, samples)
      setPrototype(proto)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBuilding(false)
    }
  }, [samples])

  /** Load the plixkws detection backend with the prototype and start. */
  const handleStartPlix = useCallback(async () => {
    setError(null)
    const engine = engineRef.current!
    const proto = prototype
    if (!proto) {
      setError('Build a prototype first.')
      return
    }
    if (!afePipeline || !afeRunning) {
      setError('Start the AFE microphone first.')
      return
    }
    try {
      // Fresh worker + engine: dispose and recreate so the plixkws backend
      // boots cleanly with the prototype (KWSEngine.load guards re-entry).
      engine.dispose()
      const fresh = new KWSEngine()
      fresh.onScore((s) => {
        setLastScore(s.smoothedScore)
        fsHistoryRef.current.push(s)
        if (fsHistoryRef.current.length > HISTORY_MAX) fsHistoryRef.current.shift()
      })
      fresh.onTrigger(() => {
        setTriggerFlash(true)
        setTimeout(() => setTriggerFlash(false), 500)
      })
      engineRef.current = fresh
      fresh.setConfig({ ...DEFAULT_CONFIG, backend: 'plixkws' })
      const { url, runtime } = resolvePlixLocator()
      await fresh.load(
        { plixkws: url, runtime },
        proto.vector,
        // Few-Shot detection params from the config panel (epic #53 P1):
        // windowMs + useNegativePrototype reach the plix backend via the
        // worker load message -> initWithPrototype opts.
        { windowMs: fsConfig.windowMs, useNegative: fsConfig.useNegativePrototype },
      )
      fresh.start({ onOutput: (cb) => afePipeline.onOutput(cb) })
      setDetecting(true)
      setStatus('running')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [afePipeline, afeRunning, prototype, resolvePlixLocator, fsConfig.windowMs, fsConfig.useNegativePrototype])

  const handleStopPlix = useCallback(() => {
    engineRef.current?.stop()
    setDetecting(false)
    fsHistoryRef.current = []
  }, [])


  const handleStart = useCallback(() => {
    if (!engineRef.current || !afePipeline || !afeRunning) return
    engineRef.current.start({
      onOutput: (cb) => afePipeline.onOutput(cb),
    })
    setRunning(true)
    setWarmup(true)
    // Warmup: the backend needs ~76 mel frames + 16 embeddings (~2 s) before
    // producing real scores. Clear the badge after 3 s.
    setTimeout(() => setWarmup(false), 3000)
  }, [afePipeline, afeRunning])

  const handleStop = useCallback(() => {
    engineRef.current?.stop()
    setRunning(false)
    historyRef.current = []
  }, [])

  // Expose load/start/stop to the workspace pipeline runner via commandRef
  // (epic #53 P4). The runner drives the unified Start/Stop; the panel keeps
  // its own Load/Reload buttons.
  useEffect(() => {
    if (commandRef) {
      commandRef.current = {
        load: handleLoad,
        start: handleStart,
        stop: handleStop,
        getState: () => ({ status, running, isFewShot }),
      }
    }
  }, [commandRef, handleLoad, handleStart, handleStop, status, running, isFewShot])

  const updateConfig = useCallback((patch: Partial<KWSConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch }
      engineRef.current?.setConfig(patch)
      return next
    })
    // Persist to the active project's KWS snapshot.
    persist(patch)
  }, [persist])

  // Keep the shared Phase 2 score curve in sync with the detection
  // threshold (epic #53 P7).
  useEffect(() => {
    setThreshold(config.threshold)
  }, [config.threshold, setThreshold])

  // plixkws detection: render the prototype-distance score curve.
  useEffect(() => {
    if (!detecting) return
    let rafId: number
    const render = () => {
      const canvas = fsCanvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          drawScoreCurve(ctx, canvas, fsHistoryRef.current, fsConfig.threshold)
        }
      }
      rafId = requestAnimationFrame(render)
    }
    rafId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafId)
  }, [detecting, fsConfig.threshold])

  // Create the engine on mount (so backend/config changes made via the panel
  // before the first Load actually reach it), wire subscriptions, and push the
  // current config in.
  useEffect(() => {
    if (!engineRef.current) {
      engineRef.current = new KWSEngine()
    }
    const engine = engineRef.current
    engine.onScore((s) => {
      setLastScore(s.smoothedScore)
      historyRef.current.push(s)
      if (historyRef.current.length > HISTORY_MAX) {
        historyRef.current.shift()
      }
    })
    engine.onTrigger((e: KWSTriggerEvent) => {
      setTriggerFlash(true)
      setTimeout(() => setTriggerFlash(false), 500)
      // Publish to the session console (Phase 4).
      logTrigger('kws', e)
    })
    engine.onPartial((text: string) => {
      if (text) {
        setLastKeyword(text)
        logInfo('kws', `partial: ${text}`)
      }
    })
    engine.setConfig({ backend: config.backend, threshold: config.threshold })
    return () => engine.dispose()
  }, [config.backend, config.threshold])

  const canStart = status === 'ready' && afeRunning && !running

  return (
    <section className="space-y-8">
      {!embedded && (
        <div>
          <h2 className="text-lg font-semibold text-ink-1">KWS detection</h2>
          <p className="text-sm text-ink-2">
            Pluggable KWS backend (ADR-020) running in a Web Worker (ADR-018).
            Pick a backend below; models load from the platform registry
            (ADR-011/027). openWakeWord (hey-buddy, mel-spectrogram -&gt;
            speech-embedding -&gt; classifier) is the default; PLiX Few-Shot adds
            custom wake-word enrollment. VAD gating via AFE RNNoise VAD.
          </p>
        </div>
      )}

      {/* Backend selection - pure choice, no loading/action. Loading and
          detection live in the Engine card below. */}
      <div className="flex flex-wrap items-center gap-4 whitespace-nowrap rounded-xl border border-line bg-surface-2 p-5">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-2">Backend</span>
          <select
            value={config.backend}
            disabled={status === 'loading' || running || detecting}
            onChange={(e) =>
              updateConfig({ backend: e.target.value as KWSConfig['backend'] })
            }
            className="truncate rounded bg-surface-3 px-2 py-1 text-ink-2"
          >
            {getBackendRegistry().map((r) => (
              <option key={r.id} value={r.id} disabled={!r.browserFeasible}>
                {r.id}
              </option>
            ))}
          </select>
        </label>

        {/* Trigger flash */}
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
            triggerFlash
              ? 'scale-125 bg-amber-400 text-ink-1'
              : 'bg-surface-4 text-ink-3'
          }`}
        >
          {triggerFlash ? '!' : '·'}
        </div>

        {error && <span className="text-sm text-danger">{error}</span>}
      </div>

      {/* Engine card - the primary action area: resource loading (per-backend)
          + detection start/stop. Kept separate from backend selection so
          switching backends is instant and the heavy actions are grouped. */}
      <div className="space-y-4 rounded-xl border border-line bg-surface-2 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink-1">Engine</h3>
            <span className="text-xs text-ink-3">
              {isFewShot ? 'PLiX Few-Shot' : config.backend} ·{' '}
              {status === 'ready' && !isFewShot
                ? `${executionProvider === 'webgpu' ? 'WebGPU' : 'WASM'}`
                : status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isFewShot && status === 'idle' && (
              <button
                onClick={handleLoad}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-1 transition-colors hover:bg-brand-400"
              >
                Load models
              </button>
            )}
            {!isFewShot && (status === 'ready' || status === 'error') && (
              <button
                onClick={handleLoad}
                className="rounded-lg bg-surface-3 px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-4"
              >
                Reload models
              </button>
            )}
            {isFewShot && status !== 'ready' && status !== 'running' && !detecting && (
              <button
                onClick={handleLoadEncoder}
                disabled={status === 'loading'}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-1 hover:bg-brand-400 disabled:opacity-50"
              >
                {status === 'loading' ? 'Loading PLiX…' : 'Load PLiX encoder'}
              </button>
            )}
            {!isFewShot && canStart && (
              <button
                onClick={handleStart}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-ink-1 transition-colors hover:bg-emerald-500"
              >
                Start detection
              </button>
            )}
            {!isFewShot && running && (
              <button
                onClick={handleStop}
                className="rounded-lg bg-danger/90 px-4 py-2 text-sm font-medium text-ink-1 transition-colors hover:bg-red-500"
              >
                Stop detection
              </button>
            )}
            {isFewShot && prototype && !detecting && (
              <button
                onClick={handleStartPlix}
                disabled={!afeRunning}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-ink-1 hover:bg-emerald-500 disabled:opacity-50"
              >
                Start Few-Shot detection
              </button>
            )}
            {isFewShot && detecting && (
              <button
                onClick={handleStopPlix}
                className="rounded-lg bg-danger/90 px-4 py-2 text-sm font-medium text-ink-1 hover:bg-red-500"
              >
                Stop Few-Shot detection
              </button>
            )}
          </div>
        </div>

        {/* Load status + resource hints */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
          {status === 'loading' && (
            <span className="text-ink-2">Loading models…</span>
          )}
          {status === 'ready' && !isFewShot && !afeRunning && (
            <span className="text-warning">
              Start the AFE microphone first
            </span>
          )}
          {running && warmup && (
            <span className="text-warning">
              Warming up… (collecting ~2 s of audio context)
            </span>
          )}
          {status === 'ready' && !isFewShot && (
            <span>Models loaded · EP: {executionProvider === 'webgpu' ? 'WebGPU' : 'WASM'}</span>
          )}
          {status === 'ready' && isFewShot && (
            <span className="text-ink-2">PLiX encoder loaded — record samples to enroll</span>
          )}
          {isFewShot && detecting && (
            <span className="text-ink-2">Few-Shot detection running</span>
          )}
          {error && status === 'error' && !isFewShot && (
            <span className="text-danger">Load failed — check the registry / assets</span>
          )}
        </div>

        {/* Resources this backend needs (models + persistent data). Each row
            shows its own state: not loaded / loading / ready / error. */}
        <div className="space-y-1.5 border-t border-line pt-3">
          <div className="text-[11px] font-medium uppercase tracking-widest text-ink-3">
            Resources
          </div>
          {(ENGINE_RESOURCES[isFewShot ? 'few-shot' : selectedBackend?.category ?? 'traditional'] ?? [])
            .map((res) => {
              const ready =
                res.kind === 'model'
                  ? status === 'ready'
                  : res.id === 'prototypes'
                    ? savedPrototypes.length > 0
                    : res.id === 'samples'
                      ? savedSampleCount > 0
                      : res.id === 'keywords'
                        ? !!driverValues.keywords
                        : false
              const detail =
                res.id === 'prototypes'
                  ? savedPrototypes.map((p) => p.word).join(', ') || 'none saved'
                  : res.id === 'samples'
                    ? `${savedSampleCount} sample(s) saved`
                    : res.id === 'keywords'
                      ? `${String(driverValues.keywords ?? '').split('\n').filter(Boolean).length} keyword(s)`
                      : status === 'loading'
                        ? 'loading…'
                        : res.urlKey
                          ? urlsRef.current[res.urlKey] ?? 'not loaded'
                          : ''
              return (
                <div key={res.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      status === 'loading'
                        ? 'animate-pulse bg-amber-400'
                        : ready
                          ? 'bg-emerald-500'
                          : 'bg-surface-4'
                    }`}
                  />
                  <span className="text-ink-2">{res.label}</span>
                  {detail && (
                    <span className="max-w-[420px] truncate font-mono text-[10px] text-ink-3">
                      {detail}
                    </span>
                  )}
                </div>
              )
            })}
        </div>

        {/* Model sources - the user can pick which pretrained model each role
            uses (built-in registry entries) or supply a custom URL (e.g. a
            model trained with this platform). The selection overrides the
            registry defaults on the next Load. */}
        <div className="space-y-3 border-t border-line pt-3">
          <div className="text-[11px] font-medium uppercase tracking-widest text-ink-3">
            Model sources
          </div>
          <p className="text-xs text-ink-3">
            Pick the pretrained model per role (built-in registry), a saved
            model from your library, a local file, or a custom URL. Saved
            models are stored in your browser (IndexedDB) and can be exported
            back to disk. Applied on the next Load/Reload.
          </p>
          {(isFewShot ? FEWSHOT_MODEL_ROLES : TRADITIONAL_MODEL_ROLES).map(({ role, label, fallbackId }) => {
                const options = registryModels
                  ? modelSourcesForRole(registryModels, role, customUrls[role])
                  : []
                const selected = modelSources[role]
                const isCustom = selected === 'custom'
                const isUserModel = selected?.startsWith('user:') ?? false
                const roleUserModels = userModels.filter((m) => m.role === role)
                const selectedModelId = isUserModel && selected ? selected.slice(5) : undefined
                const selectedModel = roleUserModels.find((m) => m.id === selectedModelId)
                const currentUrl = isCustom
                  ? customUrls[role] ?? ''
                  : registryModels
                    ? modelSourcesForRole(registryModels, role, customUrls[role])
                        .find((o) => o.id === (selected ?? fallbackId))
                        ?.url ?? ''
                    : ''
                return (
                  <div key={role} className="space-y-1">
                    <label className="flex items-center gap-2 text-xs">
                      <span className="w-36 shrink-0 text-ink-2">{label}</span>
                      <select
                        value={selected ?? fallbackId}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v.startsWith('user:')) {
                            void handleSelectUserModel(role, v.slice(5))
                          } else {
                            setModelSources((prev) => ({ ...prev, [role]: v }))
                          }
                        }}
                        disabled={status === 'loading' || running}
                        className="truncate rounded bg-surface-3 px-2 py-1 text-ink-2"
                      >
                        {options.length === 0 && (
                          <option value={fallbackId}>Built-in ({fallbackId})</option>
                        )}
                        {options.map((o) => (
                          <option key={o.id} value={o.id} title={o.note}>
                            {o.label}
                          </option>
                        ))}
                        {roleUserModels.length > 0 && (
                          <optgroup label="Saved models">
                            {roleUserModels.map((m) => (
                              <option key={m.id} value={`user:${m.id}`}>
                                {m.name} ({m.sizeBytes / 1024 / 1024 > 1
                                  ? (m.sizeBytes / 1024 / 1024).toFixed(1) + ' MB'
                                  : Math.round(m.sizeBytes / 1024) + ' KB'})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </label>
                    {isCustom && (
                      <input
                        type="text"
                        value={customUrls[role] ?? ''}
                        onChange={(e) =>
                          setCustomUrls((prev) => ({
                            ...prev,
                            [role]: e.target.value,
                          }))
                        }
                        placeholder="https://… or /modules/…/model.onnx"
                        disabled={status === 'loading' || running}
                        className="w-full rounded bg-surface-3 px-2 py-1 text-xs font-mono text-ink-2"
                      />
                    )}
                    {isUserModel && selectedModel && (
                      <div className="flex items-center gap-2 text-[10px] text-ink-3">
                        <span>
                          Saved: {selectedModel.name} · {Math.round(selectedModel.sizeBytes / 1024)} KB ·{' '}
                          {new Date(selectedModel.createdAtMs).toLocaleDateString()}
                        </span>
                        <button
                          onClick={() => void exportUserModel(selectedModel)}
                          className="text-brand-400 underline hover:text-brand-300"
                        >
                          Export
                        </button>
                        <button
                          onClick={() => {
                            void deleteUserModel(selectedModel.id)
                            setUserModels((prev) => prev.filter((m) => m.id !== selectedModel.id))
                            setModelSources((prev) => ({ ...prev, [role]: fallbackId }))
                          }}
                          className="text-danger underline hover:text-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={status === 'loading' || running}
                        className="rounded bg-surface-3 px-2 py-0.5 text-[10px] text-ink-2 hover:bg-surface-4"
                      >
                        Import local file…
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".onnx,.tflite"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          void handleImportModelFile(f, role)
                          e.target.value = ''
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-ink-3">
                      {isCustom
                        ? 'Custom URL — will be fetched as-is on Load.'
                        : isUserModel
                          ? 'Saved model — loaded from your browser library on Load.'
                          : `URL: ${currentUrl || 'not loaded yet'}`}
                    </p>
                  </div>
                )
              })}
        </div>
      </div>

      {/* plixkws enrollment + detection (Few-Shot, Phase 3) - inline in the KWS
          panel; the standalone Few-Shot panel was merged here. The encoder
          variant + runtime are the plix driver's spec params (ADR-025). */}
      {isFewShot && (
        <div className="space-y-6 rounded-xl border border-line bg-surface-2 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <h3 className="text-sm font-semibold text-ink-1">
              PLiX Few-Shot enrollment{' '}
              <span className="text-xs font-normal text-ink-3">
                (Phase 3 · enroll a custom wake word, then detect)
              </span>
            </h3>
          </div>

          {status === 'error' && !detecting && (
            <p className="text-sm text-danger">
              Encoder load failed: {error} — check the encoder variant/runtime
              or the exported model assets.
            </p>
          )}

          {/* plix driver config (ADR-025): the encoder/runtime params from the
              plix driver spec, rendered via module-kit controls. The enrollment
              flow below consumes these values via driverValues. */}
          {driverParams.length > 0 && !detecting && (
            <UnifiedConfigPanel
              title={`${config.backend} driver`}
              subtitle="Params from the driver module spec (ADR-025). Applied on Load."
              params={driverParams}
              values={driverValues}
              onParamChange={(id, v) =>
                setDriverValues((prev) => ({ ...prev, [id]: v }))
              }
              advancedIds={[]}
              disabled={recording || status === 'loading'}
            />
          )}

          {status === 'ready' && !detecting && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleRecord}
                  disabled={recording}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-ink-1 hover:bg-emerald-500 disabled:opacity-50"
                >
                  {recording ? `Recording… (${RECORD_MS}ms)` : 'Record sample'}
                </button>
                {samples.length >= MIN_SAMPLES && (
                  <button
                    onClick={handleBuildPrototype}
                    disabled={building}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-1 hover:bg-brand-400 disabled:opacity-50"
                  >
                    {building ? 'Building…' : `Build prototype (${samples.length} samples)`}
                  </button>
                )}
                {samples.length > 0 && (
                  <span className="text-xs text-ink-3">
                    {samples.length}/{MIN_SAMPLES}+ samples recorded
                  </span>
                )}
              </div>

              {samples.length > 0 && (
                <div className="space-y-1 text-xs text-ink-2">
                  {samples.map((s, i) => (
                    <div key={s.id} className="flex gap-3">
                      <span className="w-8 font-mono">#{i + 1}</span>
                      <span>{s.quality.durationMs.toFixed(0)} ms</span>
                      <span>{s.quality.peakDbfs.toFixed(1)} dBFS</span>
                      <span>SNR {s.quality.snrDb.toFixed(1)} dB</span>
                      <span className={s.quality.acceptable ? 'text-success' : 'text-warning'}>
                        {s.quality.clipped ? 'clipped' : s.quality.acceptable ? 'OK' : 'low quality'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {prototype && (
                <div className="space-y-2">
                  <p className="text-xs text-success">
                    Prototype built: {prototype.word} ({prototype.vector.length}-dim
                    vector). Ready for detection.
                  </p>
                  {!afeRunning && (
                    <span className="text-xs text-warning">
                      Start the AFE microphone (top panel) first.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {detecting && (
            <div className="space-y-2">
              <div className="rounded-xl border border-line bg-surface-2 p-5">
                <div className="mb-2 flex items-center justify-between text-xs text-ink-3">
                  <span>Few-Shot score curve (prototype-distance similarity)</span>
                  <span className="font-mono">
                    {fsHistoryRef.current.length > 0
                      ? `score: ${fsHistoryRef.current[fsHistoryRef.current.length - 1].smoothedScore.toFixed(3)}`
                      : ''}
                  </span>
                </div>
                <canvas
                  ref={fsCanvasRef}
                  width={800}
                  height={160}
                  className="h-[160px] w-full rounded bg-surface-3"
                />
              </div>
            </div>
          )}

          {/* Few-Shot detection params (from the few-shot module's spec) - shown
              once a prototype exists so the user can tune before/while running. */}
          {prototype && (
            <UnifiedConfigPanel
              title="Few-Shot detection parameters"
              subtitle="Rendered from the few-shot module's describeParameters() via module-kit controls."
              params={fewShotDescribeParameters()}
              values={fsConfig as unknown as Record<string, ParamValue>}
              onParamChange={(id, v) => {
                setFsConfig((prev) => {
                  const next = { ...prev, [id]: v }
                  // Persist the few-shot detection params to the project
                  // snapshot (#53 P1) so a project switch does not lose them.
                  persistFs(next as Partial<typeof FS_DEFAULTS>)
                  return next
                })
              }}
              advancedIds={[
                'smoothingWindowFrames',
                'windowMs',
                'vadGateEnabled',
                'vadThreshold',
                'hopMs',
                'useNegativePrototype',
              ]}
              disabled={detecting}
            />
          )}
        </div>
      )}

      {/* Config panel (ADR-017) - dual-layer: Primary + Advanced (kws-categories
          §4.1). Rendered whenever a backend is selected (even before load): the
          params come from the specs, not from the engine state, so they are
          editable up front and applied on the next Load. */}
      {!isFewShot && (
        <div className="rounded-xl border border-line bg-surface-2 p-5">
          <h3 className="mb-4 text-sm font-semibold text-ink-1">
            Configuration{' '}
            <span className="text-xs font-normal text-ink-3">
              (backend · Primary)
            </span>
          </h3>

          {/* Driver params from the selected backend's registration spec
              (ADR-025) - flat rows, no nested panel (epic #53 UX). */}
          {driverParams.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-ink-3">
                {config.backend} driver
              </div>
              <div className="divide-y divide-line">
                <ParamRows
                  ids={driverParams.map((p) => p.id)}
                  params={driverParams}
                  values={driverValues}
                  onParamChange={(id, v) =>
                    setDriverValues((prev) => ({ ...prev, [id]: v }))
                  }
                  disabled={running || status === 'loading'}
                />
              </div>
            </div>
          )}

          {/* Tunable params rendered from the spec descriptors (module-kit) —
              flat rows. The 'backend' param is excluded (already selectable
              in the controls row above, ADR-020). */}
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-ink-3">
              Tunable parameters
            </div>
            <div className="divide-y divide-line">
              <ParamRows
                ids={params.filter((p) => p.id !== 'backend').map((p) => p.id)}
                params={params}
                values={config as unknown as Record<string, ParamValue>}
                onParamChange={(id, v) => updateConfig({ [id]: v })}
                disabled={running || status === 'loading'}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-3">
            {params.length} parameters exposed via{' '}
            <code className="text-ink-2">describeParameters()</code>. Mel
            window: {MEL_WINDOW_SIZE} samples (80 ms @ 16 kHz).
            {lastKeyword && (
              <>
                {' '}Last keyword:{' '}
                <span className="text-emerald-300/80">{lastKeyword}</span>
              </>
            )}
          </p>
        </div>
      )}
    </section>
  )
})
