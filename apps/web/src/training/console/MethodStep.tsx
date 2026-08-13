/**
 * Training wizard — Step 3: Choose train method (issue #105).
 *
 * The methods the selected module supports, from its spec.train.invocation
 * (methodsFor). Each method card shows its specific config (Colab → tunnel
 * URL, Self-hosted → endpoint URL; client-side only).
 */

import { methodsFor, type TrainMethod, type TrainMethodId } from '@wake-studio/module-training'
import type { TrainableModule } from '../train-modules'
import { cn } from '../../components/cn'

export interface MethodStepProps {
  module: TrainableModule
  selected: TrainMethodId | null
  onSelect: (method: TrainMethodId) => void
  /** The url config value for the selected method (tunnel / endpoint). */
  urlValue: string
  onChangeUrl: (url: string) => void
}

export function MethodStep({ module, selected, onSelect, urlValue, onChangeUrl }: MethodStepProps) {
  const methods = methodsFor(module.train.invocation)
  const selectedMethod: TrainMethod | undefined = methods.find((m) => m.id === selected)

  return (
    <div className="space-y-3">
      {methods.map((method) => {
        const active = method.id === selected
        return (
          <div
            key={method.id}
            className={cn(
              'rounded-xl border p-4 transition-colors',
              active
                ? 'border-brand-500/60 bg-brand-500/5'
                : 'border-line bg-surface-2',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(method.id)}
              aria-pressed={active}
              className="flex w-full items-start justify-between gap-3 text-left"
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

            {active && method.urlConfig && (
              <div className="mt-3 space-y-1.5 border-t border-line pt-3">
                <label
                  htmlFor={`train-${method.id}-url`}
                  className="block text-xs font-medium text-ink-2"
                >
                  {method.urlConfig.urlLabel}
                </label>
                <input
                  id={`train-${method.id}-url`}
                  type="url"
                  placeholder={method.urlConfig.placeholder}
                  value={urlValue}
                  onChange={(e) => onChangeUrl(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-400"
                />
                <p className="text-[11px] leading-relaxed text-ink-3">{method.urlConfig.hint}</p>
              </div>
            )}
          </div>
        )
      })}

      {!selectedMethod && (
        <p className="text-xs text-ink-3">Pick one of the methods above to continue.</p>
      )}
    </div>
  )
}