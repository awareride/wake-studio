/**
 * Workspace view (Phase 2) - project bar + pipeline canvas + stepped panels.
 *
 * Layout:
 *   1. Project bar (select / create active project)
 *   2. Pipeline canvas (AEC -> BSS -> NS -> KWS) with shared run/stop
 *   3. Stepped panels: Live (AFE / KWS / Few-Shot) and Modules (Training /
 *      pipeline info), hosted in tabs.
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
import { FewShotPanel } from '../components/FewShotPanel'
import { TrainingModulePanel } from '@wake-studio/module-training/web'
import { PipelineView } from '../components/PipelineView'
import { Domains } from '../components/Domains'
import { ProjectBar } from '../components/ProjectBar'
import { PipelineCanvas } from '../components/PipelineCanvas'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui'
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

      {/* Stepped panels - tab container (IDE-style): tab bar + content box. */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
        <Tabs defaultValue="live">
          <TabsList className="bg-surface-2">
            <TabsTrigger value="live">Live pipeline</TabsTrigger>
            <TabsTrigger value="modules">Modules</TabsTrigger>
          </TabsList>
          <TabsContent value="live" className="p-5">
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
              <FewShotPanel
                key={`fs-${current?.id ?? 'none'}`}
                afePipeline={afeRef.current}
                afeRunning={afeRunning}
              />
            </div>
          </TabsContent>
          <TabsContent value="modules" className="p-5">
            <div className="space-y-8">
              <TrainingModulePanel />
              <PipelineView />
              <Domains />
            </div>
          </TabsContent>
        </Tabs>
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
