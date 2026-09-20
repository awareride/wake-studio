/**
 * Project info row (epic #53 UX review).
 *
 * No box, no dropdown — the Recent menu next to it is the project switcher.
 * This only shows the active project's core info (target word, domain, chip).
 */

import { useProjects, PROJECT_DOMAINS } from '../projects'
import { useT } from '../i18n'

export function ProjectBar() {
  const { current } = useProjects()
  const t = useT()
  if (!current) return null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
      <span>
        {`${t('Target')}:`}{' '}
        <span className="font-medium text-ink-1">{current.targetWord || '—'}</span>
      </span>
      <span>
        {`${t('Domain')}:`}{' '}
        <span className="font-medium text-ink-1">
          {(() => {
            const label = PROJECT_DOMAINS.find((d) => d.value === current.domain)?.label ?? current.domain
            return t(label)
          })()}
        </span>
      </span>
      {current.targetChip && (
        <span>
          {`${t('Chip')}:`} <span className="font-medium text-ink-1">{current.targetChip}</span>
        </span>
      )}
    </div>
  )
}
