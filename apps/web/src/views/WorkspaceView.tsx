/**
 * Workspace view (Phase 2) - project bar + pipeline canvas + panels.
 *
 * Layout:
 *   1. Project bar (select / create active project)
 *   2. Pipeline canvas (AEC -> BSS -> NS -> KWS) with shared run/stop
 *   3. Panels: live DSP (AFE / KWS / Few-Shot). (The former "Modules" tab
 *      was removed with its static PipelineView / Domains explainers, and the
 *      Training placeholder was removed until real backend wiring lands -
 *      see git history.)
 *
 * Config panels are rendered through the unified (module-kit driven) config
 * panel where the descriptors exist (read-side unification); writes still go
 * through the existing setConfig paths.
 *
 * NOTE: AFE/KWS engine internals are out of scope for the console refactor
 * (human decision 2026-08-05) - the live DSP path is untouched here.
 */

import * as React from 'react'
import { AFEPanel } from '../components/AFEPanel'
import { KWSPanel } from '../components/KWSPanel'
import { ProjectBar } from '../components/ProjectBar'
import { PipelineCanvas } from '../components/PipelineCanvas'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { useConsoleStatus } from '../status'
import { useProjects } from '../projects'

export function WorkspaceView() {
  const afeRef = React.useRef<AFEPipeline | null>(null)
  const afeCommandRef = React.useRef<{ start: () => void; stop: () => void } | null>(null)
  const [afeRunning, setAfeRunning] = React.useState(false)
  const { setStatus } = useConsoleStatus()
  const { current } = useProjects()

  const handleStart = React.useCallback(() => {
    afeCommandRef.current?.start()
  }, [])

  const handleStop = React.useCallback(() => {
    afeCommandRef.current?.stop()
  }, [])

  // Publish global status when AFE state changes.
  React.useEffect(() => {
    setStatus({
      mic: afeRunning ? 'active' : 'idle',
      worker: afeRunning ? 'running' : null,
      detection: afeRunning ? 'running' : 'stopped',
    })
  }, [afeRunning, setStatus])

  return (
    <div className="space-y-6">
      {/* Welcome + project bar */}
      <div className="rounded-xl border border-line bg-gradient-to-br from-brand-50 to-surface-2 p-5">
        <h2 className="text-lg font-semibold text-ink-1">Workspace</h2>
        <p className="mt-1 text-sm text-ink-2">
          Build, visualize and test on-device wake-word pipelines — all in the
          browser. Select or create a project, then run the pipeline.
        </p>
      </div>

      <ProjectBar />

      <PipelineCanvas
        afeRunning={afeRunning}
        onStart={handleStart}
        onStop={handleStop}
        status={useConsoleStatus().status}
      />

      {/* Live DSP panels. Training lands here when its backend wiring is real
          (currently a no-op stub - see packages/modules/training). Few-Shot
          enrollment lives inside the KWS panel's plixkws branch. */}
      <div className="space-y-8">
        {/* key={current?.id} remounts the panels when the project changes
            so their config re-seeds from the new project's snapshot. */}
        <AFEPanel
          key={`afe-${current?.id ?? 'none'}`}
          afeRef={afeRef}
          onRunningChange={setAfeRunning}
          commandRef={afeCommandRef}
        />
        <KWSPanel
          key={`kws-${current?.id ?? 'none'}`}
          afePipeline={afeRef.current}
          afeRunning={afeRunning}
        />
      </div>

      {current && (
        <p className="text-xs text-ink-3">
          Active project:{' '}
          <span className="font-medium text-ink-2">{current.name}</span> · config
          snapshots are saved with the project.
        </p>
      )}
    </div>
  )
}
