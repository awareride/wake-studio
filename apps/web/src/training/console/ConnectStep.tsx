/**
 * Training console — Step 2: Connect backend (issue #105).
 *
 * Backend readiness card. v1 backend = Colab (ADR-023 + tunnel amendment,
 * issue #106): open the module-owned notebook, run it, paste the ephemeral
 * Cloudflare tunnel URL here. Self-hosted and cloud-provider backends are
 * noted as later Phase 5 slices. The URL is client-side only (localStorage).
 */

import { useEffect, useState } from 'react'
import { buildColabUrl } from '@wake-studio/module-kit'
import { cn } from '../../components/cn'
import { IconChevronRight } from '../../components/icons'

/** The kws-openwakeword module-owned notebook (ADR-035) this view trains with. */
const OPENWAKEWORD_NOTEBOOK =
  'packages/modules/kws/openwakeword/train/colab/train.ipynb'
/** The notebook's Step 0 params cell id (set in train.ipynb). */
const OPENWAKEWORD_STEP0_CELL = 'params'

const TUNNEL_URL_KEY = 'wake-studio:train:tunnelUrl'

interface BackendCard {
  id: string
  label: string
  state: 'available' | 'later'
  blurb: string
}

const BACKENDS: BackendCard[] = [
  {
    id: 'colab',
    label: 'Google Colab',
    state: 'available',
    blurb:
      'Free GPU under your Google account — the v1 training backend. Open the notebook, run it, download the bundle (or paste the tunnel URL below for direct control, ADR-023 amendment).',
  },
  {
    id: 'self-hosted',
    label: 'Self-hosted service',
    state: 'later',
    blurb: 'Your own studio-backend endpoint. Lands in a later Phase 5 slice (no resources to self-host for now, human constraint 2026-08).',
  },
  {
    id: 'cloud',
    label: 'Cloud provider (HF, …)',
    state: 'later',
    blurb: 'Automated API backends with the user\'s own token. Deferred (C-4, issue #107).',
  },
]

export interface ConnectStepProps {
  /** Persisted tunnel URL (client-side only). */
  tunnelUrl: string
  onChangeTunnelUrl: (url: string) => void
}

export function ConnectStep({ tunnelUrl, onChangeTunnelUrl }: ConnectStepProps) {
  // Hydrate from localStorage on mount (client-side secret, ADR-013 security).
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    if (hydrated) return
    setHydrated(true)
    const saved = window.localStorage.getItem(TUNNEL_URL_KEY)
    if (saved) onChangeTunnelUrl(saved)
  }, [hydrated, onChangeTunnelUrl])

  const setUrl = (url: string) => {
    onChangeTunnelUrl(url)
    window.localStorage.setItem(TUNNEL_URL_KEY, url)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {BACKENDS.map((backend) => (
          <div
            key={backend.id}
            className={cn(
              'rounded-xl border p-4',
              backend.state === 'available'
                ? 'border-brand-500/40 bg-brand-500/5'
                : 'border-line bg-surface-2 opacity-70',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-ink-1">{backend.label}</h3>
                <a
                  href={`${buildColabUrl(OPENWAKEWORD_NOTEBOOK)}#scrollTo=${OPENWAKEWORD_STEP0_CELL}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 underline-offset-2 hover:underline"
                >
                  Open in Colab <IconChevronRight className="h-3 w-3" />
                </a>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  backend.state === 'available'
                    ? 'bg-success/15 text-success'
                    : 'bg-surface-3 text-ink-3',
                )}
              >
                {backend.state === 'available' ? 'Available' : 'Later'}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{backend.blurb}</p>

            {backend.id === 'colab' && (
              <div className="mt-3 space-y-1.5 border-t border-line pt-3">
                <label
                  htmlFor="train-tunnel-url"
                  className="block text-xs font-medium text-ink-2"
                >
                  Colab tunnel URL <span className="font-normal text-ink-3">(cloudflared, trycloudflare — optional for v1)</span>
                </label>
                <input
                  id="train-tunnel-url"
                  type="url"
                  placeholder="https://xxxx.trycloudflare.com"
                  value={tunnelUrl}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-400"
                />
                <p className="text-[11px] leading-relaxed text-ink-3">
                  With the tunnel, the PWA can drive Colab exactly like the
                  self-hosted backend (same polling + artifact download, no
                  manual zip round-trip). Stored client-side only.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}