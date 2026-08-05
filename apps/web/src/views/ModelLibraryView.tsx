/**
 * Model Library view.
 *
 * Renders the model registry (`model-registry.json`) as cards: license,
 * commercial flag, format, size, source. Backend availability is surfaced
 * from the KWS backend registry. This is the first real consumer of
 * `loadRegistry()` (which was implemented but never wired).
 */

import * as React from 'react'
import type { ModelRegistry, RegistryModel } from '../data/registry'
import { loadRegistry, isCommerciallyUsable } from '../data/registry'
import { BACKEND_REGISTRY } from '../kws'
import { IconSpinner } from '../components/icons'
import { useToast } from '../components/toast'
import { cn } from '../components/cn'

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function LicenseBadge({ model }: { model: RegistryModel }) {
  const usable = isCommerciallyUsable(model)
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        usable
          ? 'bg-emerald-500/10 text-emerald-700'
          : 'bg-amber-500/10 text-amber-700',
      )}
      title={usable ? 'Commercially usable' : 'Demo-only / check license'}
    >
      {usable ? 'commercial' : model.class}
    </span>
  )
}

export function ModelLibraryView() {
  const { toast } = useToast()
  const [registry, setRegistry] = React.useState<ModelRegistry | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    loadRegistry()
      .then((r) => {
        if (!cancelled) setRegistry(r)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          toast({
            title: 'Failed to load model registry',
            description: e instanceof Error ? e.message : String(e),
            variant: 'error',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  if (error) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-6 text-sm text-danger">
        Could not load the model registry: {error}
      </div>
    )
  }

  if (!registry) {
    return (
      <div className="flex items-center gap-3 py-16 text-sm text-ink-2">
        <IconSpinner className="h-4 w-4 text-brand-600" />
        Loading model registry…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-ink-1">Model Library</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Models are never bundled with the app (ADR-011) — they are fetched
          lazily from the registry. License + commercial flags drive the Phase 4
          export gate.
        </p>
      </div>

      {/* Backend availability */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink-1">KWS backends</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {BACKEND_REGISTRY.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="truncate text-ink-1">{b.label}</span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  b.browserFeasible
                    ? 'bg-success/10 text-success'
                    : 'bg-surface-4 text-ink-3',
                )}
                title={b.availabilityNote}
              >
                {b.browserFeasible ? 'available' : b.availabilityNote}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Models */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink-1">
          Models{' '}
          <span className="text-xs font-normal text-ink-3">
            ({registry.models.length})
          </span>
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          {registry.models.map((m) => (
            <article
              key={m.id}
              className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold text-ink-1">
                    {m.name}
                  </h4>
                  <p className="truncate text-xs text-ink-3">
                    {m.source} · {m.format}
                  </p>
                </div>
                <LicenseBadge model={m} />
              </div>

              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-2">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-3">Size</dt>
                  <dd className="font-mono">{formatBytes(m.sizeBytes)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-3">License</dt>
                  <dd className="truncate" title={m.license}>
                    {m.license}
                  </dd>
                </div>
              </dl>

              {m.notes && (
                <p className="line-clamp-3 text-xs leading-relaxed text-ink-3">
                  {m.notes}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
