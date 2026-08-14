/**
 * Training wizard — Step 3: Choose train method (issue #105).
 *
 * The methods the selected module supports, from its spec.train.invocation
 * (methodsFor). For the Studio-backend method the user also picks WHICH
 * managed backend (Backends menu) the job runs on — its URL + token feed the
 * studio-backend client. Colab's connection details (tunnel URL) are
 * generated when the notebook runs, so they belong to the train details
 * pane, not the wizard.
 */

import { methodsFor, type TrainMethodId } from '@wake-studio/module-training'
import type { TrainableModule } from '../train-modules'
import type { ManagedBackend } from '../../backends/types'
import { cn } from '../../components/cn'

export interface MethodStepProps {
  module: TrainableModule
  selected: TrainMethodId | null
  onSelect: (method: TrainMethodId) => void
  /** Managed backends for the Studio-backend method (Backends menu). */
  backends: ManagedBackend[]
  selectedBackendId: string | null
  onSelectBackend: (id: string) => void
}

const KIND_STYLE: Record<ManagedBackend['kind'], string> = {
  'long-term': 'bg-surface-3 text-ink-3',
  'short-term': 'bg-amber-500/15 text-amber-700',
}

export function MethodStep({
  module,
  selected,
  onSelect,
  backends,
  selectedBackendId,
  onSelectBackend,
}: MethodStepProps) {
  const methods = methodsFor(module.train.invocation)
  const wantsBackend = selected === 'studio-backend'

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
                ? 'border-brand-9/60 bg-brand-9/5'
                : 'border-line bg-surface-2 hover:border-brand-9/30 hover:bg-surface-3',
            )}
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink-1">{method.label}</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{method.blurb}</p>
            </div>
            <span
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                active ? 'border-brand-9 bg-brand-9/20' : 'border-ink-3/50',
              )}
              aria-hidden
            />
          </button>
        )
      })}

      {/* Backend picker for the Studio-backend method. */}
      {wantsBackend && (
        <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Backend
            </span>
            <a href="#/backends" className="text-[11px] font-medium text-brand-11 hover:underline">
              Manage backends →
            </a>
          </div>
          {backends.length === 0 ? (
            <p className="text-xs leading-relaxed text-ink-3">
              No backends yet — add one in the{' '}
              <a href="#/backends" className="font-medium text-brand-11 hover:underline">
                Backends menu
              </a>{' '}
              (long-term: run <code className="font-mono text-[10px]">uv run wake-service</code>;
              short-term: openwakeword notebook Step 1.5 tunnel).
            </p>
          ) : (
            <ul className="space-y-1.5">
              {backends.map((b) => {
                const active = b.id === selectedBackendId
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => onSelectBackend(b.id)}
                      aria-pressed={active}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left',
                        active
                          ? 'border-brand-9/60 bg-brand-9/5'
                          : 'border-line hover:border-brand-9/30',
                      )}
                    >
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          b.status === 'online'
                            ? 'bg-emerald-500'
                            : b.status === 'offline'
                              ? 'bg-danger'
                              : 'bg-ink-3/40',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-ink-1">{b.name}</span>
                        <span className="block truncate font-mono text-[10px] text-ink-3">{b.baseUrl}</span>
                      </span>
                      <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide', KIND_STYLE[b.kind])}>
                        {b.kind === 'short-term' ? 'short-term' : 'long-term'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {!selected && (
        <p className="text-xs text-ink-3">Pick one of the methods above to continue.</p>
      )}
    </div>
  )
}
