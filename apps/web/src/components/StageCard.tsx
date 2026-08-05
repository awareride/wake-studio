import type { PipelineStage } from '../data/pipeline'

const STATUS_STYLES: Record<PipelineStage['status'], string> = {
  pending: 'bg-surface-4 text-ink-3',
  'in-progress': 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
}

export function StageCard({ stage, index }: { stage: PipelineStage; index: number }) {
  return (
    <article className="relative flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700">
          {stage.abbr}
        </span>
        <h3 className="text-sm font-semibold text-ink-1">{stage.name}</h3>
      </div>
      <p className="text-sm text-ink-2">{stage.role}</p>
      <dl className="mt-auto space-y-1 text-xs text-ink-3">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0">Browser</dt>
          <dd className="text-ink-2">{stage.browserRuntime}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0">Export</dt>
          <dd className="text-ink-2">{stage.exportRuntime}</dd>
        </div>
      </dl>
      <span
        className={`absolute right-4 top-4 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[stage.status]}`}
      >
        {stage.status === 'in-progress' ? 'In progress' : stage.status}
      </span>
      <span className="absolute -left-2 top-1/2 hidden -translate-y-1/2 text-lg text-ink-3/40 md:block">
        {index < 3 ? '→' : ''}
      </span>
    </article>
  )
}
