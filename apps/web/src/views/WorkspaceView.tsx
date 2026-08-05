/**
 * Workspace view (Phase 1).
 *
 * Orchestrates the pipeline (AFE → BSS → NS → KWS) and hosts the existing
 * live panels. Phase 2 reworks the internals; this phase establishes the
 * view + a shared run/stop surface and wires shell status + toasts.
 *
 * NOTE: AFE/KWS internals are explicitly out of scope for the console
 * refactor (human decision 2026-08-05) — the panels below are mounted
 * as-is behind the workspace shell.
 */

import * as React from 'react'
import { AFEPanel } from '../components/AFEPanel'
import { KWSPanel } from '../components/KWSPanel'
import { FewShotPanel } from '../components/FewShotPanel'
import { TrainingPanel } from '../components/TrainingPanel'
import { PipelineView } from '../components/PipelineView'
import { Domains } from '../components/Domains'
import type { AFEPipeline } from '../afe'
import { useConsoleStatus } from '../status'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui'

export function WorkspaceView() {
  // Shared AFE pipeline ref + running state (same contract as before, now
  // owned by the workspace instead of the old App).
  const afeRef = React.useRef<AFEPipeline | null>(null)
  const [afeRunning, setAfeRunning] = React.useState(false)
  const { setStatus } = useConsoleStatus()

  // Publish global status when the AFE / detection state changes.
  React.useEffect(() => {
    setStatus({
      mic: afeRunning ? 'active' : 'idle',
      worker: afeRunning ? 'running' : null,
      detection: afeRunning ? 'running' : 'stopped',
    })
  }, [afeRunning, setStatus])

  return (
    <div className="space-y-8">
      {/* Welcome card (replaces the old marketing hero) */}
      <div className="rounded-xl border border-line bg-gradient-to-br from-brand-50 to-surface-2 p-6">
        <h2 className="text-xl font-semibold text-ink-1">Workspace</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Build, visualize and test on-device wake-word pipelines — all in the
          browser. Live AFE → KWS → Few-Shot enrollment below; projects and
          the full studio surface land next.
        </p>
      </div>

      {/* Pipeline status strip */}
      <div className="rounded-xl border border-line bg-surface-2 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-3">
          Pipeline · AEC → BSS → NS → KWS
        </div>
        <Tabs defaultValue="live">
          <TabsList>
            <TabsTrigger value="live">Live pipeline</TabsTrigger>
            <TabsTrigger value="modules">Modules</TabsTrigger>
          </TabsList>
          <TabsContent value="live" className="mt-4">
            <div className="space-y-8">
              <AFEPanel afeRef={afeRef} onRunningChange={setAfeRunning} />
              <KWSPanel afePipeline={afeRef.current} afeRunning={afeRunning} />
              <FewShotPanel afePipeline={afeRef.current} afeRunning={afeRunning} />
            </div>
          </TabsContent>
          <TabsContent value="modules" className="mt-4">
            <div className="space-y-8">
              <TrainingPanel />
              <PipelineView />
              <Domains />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
