/**
 * Training wizard — Step 2: Configure (issue #105).
 *
 * The selected module's train config card (from its spec.train — the
 * differences between modules) sits above the module's OWN train params
 * form (spec.train.params, rendered spec-driven by TrainParamsPanel).
 */

import type { TrainableModule } from '../train-modules'
import { cn } from '../../components/cn'

export interface ConfigStepProps {
  module: TrainableModule
}

function row(label: string, value: string | undefined, mono = true) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className={cn('font-medium text-ink-1', mono && 'font-mono')}>{value}</dd>
    </div>
  )
}

export function ConfigStep({ module }: ConfigStepProps) {
  const t = module.train
  const methods = (t.invocation ?? ['colab']).join(' · ')

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-1">{module.name} — train config</h3>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
          {module.id}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        {row('Invocation methods', methods)}
        {row('Output checkpoint', t.outputs?.checkpoint)}
        {row('Metrics', t.outputs?.metrics)}
        {t.notebookLocal && row('Colab notebook', t.notebookLocal)}
        {t.entry && row('Train entry', t.entry)}
        {t.python && row('Python', t.python)}
        {t.script && row('Upstream script', t.script.path, false)}
      </dl>

      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-3">
        {t.notebookLocal
          ? 'Trained via the module-owned Colab notebook (ADR-035) — the Ready step shows it for review and download.'
          : t.script
            ? 'Trained by the upstream script — WakeStudio adapts to it (docs/modules/training.md §4), never rewrites it.'
            : t.entry
              ? 'Trained by the module-owned train entry via uv (ADR-028).'
              : 'Train config declared in the module spec (spec.train).'}
      </p>
    </div>
  )
}