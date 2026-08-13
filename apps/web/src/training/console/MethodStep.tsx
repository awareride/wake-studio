/**
 * Training wizard — Step 3: Choose train method (issue #105).
 *
 * The methods the selected module supports, from its spec.train.invocation
 * (methodsFor). The method's connection details (Colab tunnel URL etc.) are
 * generated when the train runs — they belong to the train details pane, not
 * the wizard (the URL does not exist yet at configure time).
 */

import { methodsFor, type TrainMethodId } from '@wake-studio/module-training'
import type { TrainableModule } from '../train-modules'
import { cn } from '../../components/cn'

export interface MethodStepProps {
  module: TrainableModule
  selected: TrainMethodId | null
  onSelect: (method: TrainMethodId) => void
}

export function MethodStep({ module, selected, onSelect }: MethodStepProps) {
  const methods = methodsFor(module.train.invocation)

  return (
    <div className="space-y-3">
      {methods.map((method) => {
        const active = method.id === selected
        return (
          <button
            key={method.id}
            type="button"
            onClick={() => onSelect(method.id)}
            aria-pressed={active}
            className={cn(
              'flex w-full items-start justify-between gap-3 rounded-xl border p-4 text-left transition-colors',
              active
                ? 'border-brand-500/60 bg-brand-500/5'
                : 'border-line bg-surface-2 hover:border-brand-500/30 hover:bg-surface-3',
            )}
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink-1">{method.label}</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{method.blurb}</p>
            </div>
            <span
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                active ? 'border-brand-500 bg-brand-500/20' : 'border-ink-3/50',
              )}
              aria-hidden
            />
          </button>
        )
      })}

      {!selected && (
        <p className="text-xs text-ink-3">Pick one of the methods above to continue.</p>
      )}
    </div>
  )
}