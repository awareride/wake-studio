/**
 * Training wizard — Step 1: Choose model type (issue #105).
 *
 * Lists the trainable modules from the generated catalog (train-modules.json,
 * spec-driven — ADR-025). Selecting one moves the wizard to Configure.
 */

import { cn } from '../../components/cn'
import type { TrainableModule } from '../train-modules'

export interface ModelTypeStepProps {
  modules: TrainableModule[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function invocationSummary(module: TrainableModule): string {
  const inv = module.train.invocation ?? []
  const labels: Record<string, string> = {
    colab: 'Colab',
    'studio-backend': 'Studio-backend',
    ci: 'CI',
  }
  return inv.length ? inv.map((i) => labels[i] ?? i).join(' · ') : 'Colab'
}

function outputSummary(module: TrainableModule): string {
  const out = module.train.outputs?.checkpoint
  return out ? out.split('/').pop() ?? out : 'bundle'
}

export function ModelTypeStep({ modules, selectedId, onSelect }: ModelTypeStepProps) {
  return (
    <div className="space-y-3">
      {modules.map((module) => {
        const selected = module.id === selectedId
        return (
          <button
            key={module.id}
            type="button"
            onClick={() => onSelect(module.id)}
            aria-pressed={selected}
            className={cn(
              'w-full rounded-xl border p-4 text-left transition-colors',
              selected
                ? 'border-brand-9/60 bg-brand-9/5'
                : 'border-line bg-surface-2 hover:border-brand-9/30 hover:bg-surface-3',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink-1">{module.name}</div>
                <div className="mt-0.5 font-mono text-[11px] text-ink-3">{module.id}</div>
              </div>
              <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
                {module.category}
              </span>
            </div>

            <dl className="mt-2.5 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-ink-3">Methods</dt>
                <dd className="mt-0.5 font-medium text-ink-1">{invocationSummary(module)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Output</dt>
                <dd className="mt-0.5 truncate font-mono text-ink-1" title={module.train.outputs?.checkpoint}>
                  {outputSummary(module)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">License</dt>
                <dd className="mt-0.5 truncate text-ink-2" title={module.license}>
                  {module.license.split(';')[0]}
                </dd>
              </div>
            </dl>
          </button>
        )
      })}
    </div>
  )
}