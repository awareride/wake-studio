/**
 * Model Registry view (Phase 3).
 *
 * Renders the model registry (`model-registry.json`) as cards with:
 *  - search + tier/format filter
 *  - per-model reachability probe (HEAD -> actual size)
 *  - license + commercial flag
 *  - export license-gate dialog (Phase 4 prep)
 * Backend availability is surfaced from the KWS backend registry.
 */

import * as React from 'react'
import type { ModelRegistry, RegistryModel, ModelTier } from '@wake-studio/platform'
import { loadRegistry, isCommerciallyUsable } from '@wake-studio/platform'
import { probeModelUrl, type ProbeResult } from '@wake-studio/platform'
import { getBackendRegistry } from '@wake-studio/module-kws-engine'
import { IconSpinner } from '../components/icons'
import { Button, TextField } from '@radix-ui/themes'
import { useToast } from '../components/toast'
import { cn } from '../components/cn'
import { ExportGateDialog } from './ExportGateDialog'

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

function ProbeButton({ model }: { model: RegistryModel }) {
  const { toast } = useToast()
  const [probe, setProbe] = React.useState<ProbeResult>({
    state: 'idle',
    sizeBytes: null,
  })
  const run = async () => {
    setProbe({ state: 'probing', sizeBytes: null })
    const result = await probeModelUrl(model.url)
    setProbe(result)
    if (result.state === 'error') {
      toast({
        title: `Cannot reach ${model.id}`,
        description: result.error ?? `HTTP ${result.status}`,
        variant: 'error',
      })
    }
  }

  if (probe.state === 'ok') {
    return (
      <span className="text-[11px] text-success">
        ✓ {formatBytes(probe.sizeBytes ?? model.sizeBytes)}
      </span>
    )
  }
  if (probe.state === 'error') {
    return (
      <Button
        onClick={run}
        variant="ghost"
        size="1"
        className="h-auto text-[11px] text-danger hover:underline"
        title={probe.error}
      >
        unreachable · retry
      </Button>
    )
  }
  if (probe.state === 'probing') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-ink-3">
        <IconSpinner className="h-3 w-3" /> probing…
      </span>
    )
  }
  return (
    <Button
      onClick={run}
      variant="ghost"
      size="1"
      className="h-auto text-[11px] text-ink-3 hover:underline hover:text-ink-1"
    >
      verify reachable
    </Button>
  )
}

export function ModelLibraryView() {
  const { toast } = useToast()
  const [registry, setRegistry] = React.useState<ModelRegistry | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [tier, setTier] = React.useState<'all' | ModelTier>('all')
  const [exportModel, setExportModel] = React.useState<RegistryModel | null>(null)

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

  const models = React.useMemo(() => {
    if (!registry) return []
    const q = query.trim().toLowerCase()
    return registry.models.filter((m) => {
      if (tier !== 'all' && !m.tier.includes(tier)) return false
      if (q && !`${m.id} ${m.name} ${m.source} ${m.license}`.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [registry, query, tier])

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
        <IconSpinner className="h-4 w-4 text-brand-11" />
        Loading model registry…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-ink-1">Model Registry</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Models are never bundled with the app (ADR-011) — they are fetched
          lazily from the registry. License + commercial flags drive the export
          gate.
        </p>
      </div>

      {/* Toolbar: search + tier filter */}
      <div className="flex flex-wrap items-center gap-3">
        <TextField.Root
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models…"
          aria-label="Search models"
          className="w-64"
        />
        <div className="flex gap-1 rounded-lg border border-line bg-surface-2 p-1">
          {(['all', 'low-power', 'high-performance'] as const).map((t) => (
            <Button
              key={t}
              onClick={() => setTier(t)}
              variant={tier === t ? 'soft' : 'ghost'}
              size="1"
              className="text-xs"
            >
              {t === 'all' ? 'All' : t === 'low-power' ? 'MCU' : 'High-perf'}
            </Button>
          ))}
        </div>
      </div>

      {/* Backend availability */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink-1">KWS backends</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {getBackendRegistry().map((b) => (
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
            ({models.length} of {registry.models.length})
          </span>
        </h3>
        {models.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-surface-2/50 p-10 text-center text-sm text-ink-3">
            No models match your filter.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {models.map((m) => (
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

                <div className="mt-auto flex items-center justify-between pt-2">
                  <ProbeButton model={m} />
                  <Button
                    onClick={() => setExportModel(m)}
                    variant="outline"
                    size="1"
                    className="text-xs"
                  >
                    Export…
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {exportModel && (
        <ExportGateDialog
          model={exportModel}
          open
          onOpenChange={(open) => {
            if (!open) setExportModel(null)
          }}
        />
      )}
    </div>
  )
}
