import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { AFEPipeline as AFEPipelineClass } from '@wake-studio/module-afe-graph'
import type { StageFrameData } from '@wake-studio/module-afe-graph'
import { describeParameters } from '@wake-studio/module-afe-graph'
import { UnifiedConfigPanel } from './UnifiedConfigPanel'
import { useProjectStageConfig } from '../projects'
import { logInfo, logError } from '../log'
import { PipelineOverview } from './PipelineOverview'
import { RecordReplay } from './RecordReplay'
import { StagePanel } from './viz/StageCard'
import { SourceSelector } from './SourceSelector'
import { FileSourcePanel } from './FileSourcePanel'
import type { MicSourceConfig } from '@wake-studio/module-afe-graph'
import { FileScheduler } from '../workspace/sources/fileSource'
import type { FileSourceItem } from '../workspace/types'

interface AFEPanelProps {
  afeRef: MutableRefObject<AFEPipeline | null>
  onRunningChange: (running: boolean) => void
  /** Optional: external control (workspace pipeline canvas) to start/stop. */
  commandRef?: MutableRefObject<{ start: () => void; stop: () => void } | null>
}

/** Build a FileScheduler from the selected files (epic #53 P3). Returns null
 *  when there are no files with a decodable buffer. */
function buildFileScheduler(files: FileSourceItem[]): FileScheduler | null {
  const decodable = files.filter((f) => f.buffer)
  if (decodable.length === 0) return null
  const ctx = new AudioContext({ sampleRate: 48000 })
  if (ctx.state === 'suspended') void ctx.resume()
  const scheduler = new FileScheduler(ctx)
  for (const f of decodable) {
    scheduler.addFile(
      {
        id: f.name,
        name: f.name,
        buffer: f.buffer!,
        sampleRate: f.sampleRate,
        durationMs: f.durationMs,
        channelCount: f.channels.length,
      },
      f.channels,
    )
  }
  return scheduler
}

export function AFEPanel({ afeRef, onRunningChange, commandRef }: AFEPanelProps) {
  const { projectConfig: projCfg, persist } = useProjectStageConfig('afe')
  // Workspace snapshot holds the per-project stage toggles (epic #53); the
  // AFE bypass flags mirror them. Falls back to module defaults (AEC/BSS
  // passthrough, NS active) when no workspace snapshot exists yet.
  const { projectConfig: wsCfg, persist: persistWs } = useProjectStageConfig('workspace')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState(0)
  const [frameData, setFrameData] = useState<Record<string, StageFrameData>>({})
  // Seed vizFps from the active project's AFE snapshot (falls back to 30).
  const [vizFps, setVizFps] = useState(projCfg?.vizFps ?? 30)
  // Seed bypass from the workspace snapshot's AFE stage toggles (falls back
  // to module defaults). Bypass edits are persisted (#53 P1).
  const [bypass, setBypass] = useState(() => ({
    aec: wsCfg?.enabled?.afeStages?.aec ?? true,
    bss: wsCfg?.enabled?.afeStages?.bss ?? true,
    ns: wsCfg?.enabled?.afeStages?.ns ?? false,
  }))
  // Mic source config (epic #53 P2): seeded from the workspace snapshot's
  // source (falling back to default mic + browser DSP off), persisted on
  // change, and passed to AFEPipeline.start(source).
  const [micSource, setMicSource] = useState<MicSourceConfig>(() => {
    const s = wsCfg?.source
    if (s?.kind === 'mic') {
      return {
        deviceId: s.mic.deviceId,
        echoCancellation: s.mic.echoCancellation ?? false,
        noiseSuppression: s.mic.noiseSuppression ?? false,
        autoGainControl: s.mic.autoGainControl ?? false,
        channelCount: s.mic.channelCount ?? (projCfg?.channels ?? 1),
      }
    }
    return {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: projCfg?.channels ?? 1,
    }
  })

  const updateMicSource = useCallback(
    (next: MicSourceConfig) => {
      setMicSource(next)
      // Persist to the workspace snapshot's source (epic #53 P2).
      persistWs({
        source: { kind: 'mic', mic: next },
      })
    },
    [persistWs],
  )

  // File source (epic #53 P3): selected files + source kind toggle.
  const [sourceKind, setSourceKind] = useState<'mic' | 'file'>(
    wsCfg?.source?.kind === 'file' ? 'file' : 'mic',
  )
  const [files, setFiles] = useState<FileSourceItem[]>(() =>
    wsCfg?.source?.kind === 'file'
      ? (wsCfg.source.files ?? []).map((f) => ({ ...f, buffer: undefined }))
      : [],
  )

  const updateSourceKind = useCallback(
    (kind: 'mic' | 'file') => {
      setSourceKind(kind)
      if (kind === 'mic') {
        persistWs({ source: { kind: 'mic', mic: micSource } })
      } else {
        persistWs({ source: { kind: 'file', files } })
      }
    },
    [persistWs, micSource, files],
  )

  const updateFiles = useCallback(
    (next: FileSourceItem[]) => {
      setFiles(next)
      persistWs({ source: { kind: 'file', files: next } })
    },
    [persistWs],
  )

  // Keep a ref to bypass so toggleBypass has a stable identity (for memo).
  const bypassRef = useRef(bypass)
  bypassRef.current = bypass

  const params = describeParameters()

  const handleStart = useCallback(async () => {
    setError(null)
    if (!afeRef.current) {
      afeRef.current = new AFEPipelineClass()
    }
    const p = afeRef.current
    p.onFrame((f) => {
      setFrameData((prev) => ({ ...prev, [f.stageId]: f }))
    })
    try {
      if (sourceKind === 'file') {
        // Build the file scheduler and hand its output to the pipeline.
        const scheduler = buildFileScheduler(files)
        if (!scheduler) {
          setError('Add at least one audio file first.')
          return
        }
        afeRef.current = new AFEPipelineClass()
        const p = afeRef.current
        p.onFrame((f) => {
          setFrameData((prev) => ({ ...prev, [f.stageId]: f }))
        })
        await p.start({ nodes: [scheduler.output], dispose: () => scheduler.dispose() })
      } else {
        await p.start(micSource)
      }
      setRunning(true)
      onRunningChange(true)
      logInfo(
        'afe',
        sourceKind === 'file'
          ? `Pipeline started (file source, ${files.length} file(s))`
          : 'Pipeline started (microphone live)',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      logError('afe', err instanceof Error ? err.message : String(err))
    }
  }, [afeRef, onRunningChange, micSource, sourceKind, files])

  const handleStop = useCallback(() => {
    afeRef.current?.stop()
    setRunning(false)
    onRunningChange(false)
    setFrameData({})
    setLatencyMs(0)
    logInfo('afe', 'Pipeline stopped')
  }, [afeRef, onRunningChange])

  // Expose start/stop to the workspace pipeline canvas via commandRef.
  useEffect(() => {
    if (commandRef) {
      commandRef.current = { start: () => void handleStart(), stop: handleStop }
    }
  }, [commandRef, handleStart, handleStop])

  const toggleBypass = useCallback(
    (stageId: 'aec' | 'bss' | 'ns') => {
      const newVal = !bypassRef.current[stageId]
      setBypass((prev) => ({ ...prev, [stageId]: newVal }))
      afeRef.current?.setBypassed(stageId, newVal)
      // Persist the toggle to the workspace snapshot's AFE stage toggles
      // (#53 P1). The `afe` snapshot has no bypass field (AFEConfig), so the
      // workspace snapshot is the right home.
      persistWs({
        enabled: {
          ...(wsCfg?.enabled ?? { afe: true, afeStages: { aec: true, bss: true, ns: false }, kws: false }),
          afeStages: { ...bypassRef.current, [stageId]: newVal },
        },
      })
    },
    [afeRef, persistWs, wsCfg],
  )

  // Poll latency while running.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      if (afeRef.current) {
        setLatencyMs(afeRef.current.latencyMs)
      }
    }, 200)
    return () => clearInterval(id)
  }, [running, afeRef])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      afeRef.current?.stop()
      onRunningChange(false)
    }
  }, [afeRef, onRunningChange])

  const latencyColor =
    latencyMs > 150
      ? 'text-danger'
      : latencyMs > 100
        ? 'text-warning'
        : 'text-success'

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-ink-1">Live AFE pipeline</h2>
        <p className="text-sm text-ink-2">
          Phase 1 · AEC (passthrough) -&gt; BSS (passthrough) -&gt; NS (RNNoise
          WASM). AEC3 and BSS are deferred (ADR-016); VAD from RNNoise for v1.
        </p>
      </div>

      {/* Input source (epic #53 P2/P3) - mic device picker or file list. */}
      {!running && (
        <div className="space-y-3">
          <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-2 p-1">
            <button
              onClick={() => updateSourceKind('mic')}
              className={`rounded-md px-3 py-1 text-sm font-medium ${
                sourceKind === 'mic'
                  ? 'bg-brand-500 text-ink-1'
                  : 'text-ink-2 hover:bg-surface-3'
              }`}
            >
              Microphone
            </button>
            <button
              onClick={() => updateSourceKind('file')}
              className={`rounded-md px-3 py-1 text-sm font-medium ${
                sourceKind === 'file'
                  ? 'bg-brand-500 text-ink-1'
                  : 'text-ink-2 hover:bg-surface-3'
              }`}
            >
              Audio files
            </button>
          </div>
          {sourceKind === 'mic' ? (
            <SourceSelector value={micSource} onChange={updateMicSource} />
          ) : (
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <FileSourcePanel files={files} onChange={updateFiles} />
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-nowrap items-center gap-4 overflow-x-auto rounded-xl border border-line bg-surface-2 p-5">
        {!running ? (
          <button
            onClick={handleStart}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-1 transition hover:bg-brand-400"
          >
            Start microphone
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="rounded-lg bg-danger/90 px-4 py-2 text-sm font-medium text-ink-1 transition hover:bg-red-500"
          >
            Stop
          </button>
        )}

        {running && (
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-ink-2">Latency:</span>
            <span className={`inline-block w-14 text-right font-mono font-semibold ${latencyColor}`}>
              {latencyMs.toFixed(0)} ms
            </span>
            <span className="text-ink-3">/ 150 ms budget</span>
          </div>
        )}

        {error && (
          <span className="text-sm text-danger">{error}</span>
        )}
      </div>

      {/* Pipeline overview (flow + scrolling curve) */}
      {running && (
        <div>
          <PipelineOverview
            frameData={frameData}
            running={running}
            latencyMs={latencyMs}
          />
        </div>
      )}

      {/* Per-stage panels - items-stretch keeps the three cards equal height
          (NS has extra VAD + Spectrum rows, so without stretching it would
          exceed AEC/BSS and break the row alignment). */}
      {running && (
        <div className="grid gap-4 sm:grid-cols-3 items-stretch">
          {(['aec', 'bss', 'ns'] as const).map((id) => (
            <StagePanel
              key={id}
              id={id}
              data={frameData[id]}
              isBypassed={bypass[id]}
              onToggleBypass={toggleBypass}
            />
          ))}
        </div>
      )}

      {/* Record & replay */}
      {running && (
        <div className="mt-4">
          <RecordReplay pipeline={afeRef.current} running={running} />
        </div>
      )}

      {/* Config panel (ADR-017) - unified spec-driven rendering. */}
      <div className="mt-6 rounded-xl border border-line bg-surface-2 p-5">
        <h3 className="mb-4 text-sm font-semibold text-ink-1">
          Configuration{' '}
          <span className="text-xs font-normal text-ink-3">(ADR-017)</span>
        </h3>
        <UnifiedConfigPanel
          title="Pipeline parameters"
          subtitle="Rendered from describeParameters() via module-kit controls."
          params={params}
          values={{
            vizFps,
            'bypass.aec': bypass.aec,
            'bypass.bss': bypass.bss,
            'bypass.ns': bypass.ns,
          }}
          onParamChange={(id, v) => {
            if (id === 'vizFps') {
              const n = Number(v)
              setVizFps(n)
              afeRef.current?.setConfig({ vizFps: n })
              persist({ vizFps: n })
            } else if (id.startsWith('bypass.')) {
              const stageId = id.slice('bypass.'.length) as 'aec' | 'bss' | 'ns'
              toggleBypass(stageId)
            }
          }}
          advancedIds={['bypass.aec', 'bypass.bss', 'bypass.ns', 'latencyBudgetMs']}
          disabled={running}
        />
        <p className="mt-3 text-xs text-ink-3">
          {params.length} parameters exposed via{' '}
          <code className="text-ink-2">describeParameters()</code> · config
          panel is built incrementally per phase.
        </p>
      </div>
    </section>
  )
}


