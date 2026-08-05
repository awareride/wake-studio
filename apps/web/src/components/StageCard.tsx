import type { PipelineStage } from '../data/pipeline'

const STATUS_STYLES: Record<PipelineStage['status'], string> = {
  pending: 'bg-slate-700 text-slate-300',
  'in-progress': 'bg-amber-500/20 text-amber-300',
  done: 'bg-emerald-500/20 text-emerald-300',
}

export function StageCard({ stage, index }: { stage: PipelineStage; index: number }) {
  return (
    <article className="relative flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-sm font-bold text-brand-300">
          {stage.abbr}
        </span>
        <h3 className="text-sm font-semibold text-white">{stage.name}</h3>
      </div>
      <p className="text-sm text-slate-400">{stage.role}</p>
      <dl className="mt-auto space-y-1 text-xs text-slate-500">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0">Browser</dt>
          <dd className="text-slate-300">{stage.browserRuntime}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0">Export</dt>
          <dd className="text-slate-300">{stage.exportRuntime}</dd>
        </div>
      </dl>
      <span
        className={`absolute right-4 top-4 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[stage.status]}`}
      >
        {stage.status === 'in-progress' ? 'In progress' : stage.status}
      </span>
      <span className="absolute -left-2 top-1/2 hidden -translate-y-1/2 text-lg text-white/20 md:block">
        {index < 3 ? '→' : ''}
      </span>
    </article>
  )
}
