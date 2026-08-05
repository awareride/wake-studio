import { PIPELINE } from '../data/pipeline'
import { StageCard } from './StageCard'

export function PipelineView() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-ink-1">The pipeline</h2>
        <p className="text-sm text-ink-2">
          A fixed four-stage front-end (ADR-001): each stage is pluggable,
          bypassable, and visualized in real time from Phase 1 onward.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PIPELINE.map((stage, index) => (
          <StageCard key={stage.id} stage={stage} index={index} />
        ))}
      </div>
    </section>
  )
}
