/**
 * Datasets console — shared display helpers (labels, formatting).
 */

import type { DatasetKind, LabelRole } from '@wake-studio/module-dataset'

/** Kind badge label (ADR-044 §4.2 + §8 rail). */
export const KIND_LABEL: Record<string, string> = {
  builtin: 'Built-in',
  generated: 'Generated',
  uploaded: 'Uploaded',
  public: 'Public',
}

/** Semantic role label (the portable vocabulary, §4.2). */
export const ROLE_LABEL: Record<string, string> = {
  positive: 'positives',
  unknowns: 'unknowns',
  noise: 'noise',
  mixed: 'mixed',
}

/** Kind badge color (Tailwind classes, Radix token palette). */
export function kindBadgeClass(kind: string): string {
  switch (kind) {
    case 'builtin':
      return 'bg-sky-500/15 text-sky-700'
    case 'generated':
      return 'bg-emerald-500/15 text-emerald-700'
    case 'uploaded':
      return 'bg-violet-500/15 text-violet-700'
    case 'public':
      return 'bg-amber-500/15 text-amber-700'
    default:
      return 'bg-surface-3 text-ink-3'
  }
}

/** Join distinct label roles into a short phrase, e.g. "positives/unknowns". */
export function rolesLabel(roles: LabelRole[], role: string): string {
  if (roles.length) return roles.join('/')
  return ROLE_LABEL[role] ?? role
}

/** Human-readable clip count ("210 clips" / "1 clip"). */
export function formatClips(clips: number): string {
  if (clips <= 0) return 'no clips'
  return `${clips} ${clips === 1 ? 'clip' : 'clips'}`
}

/** Human-readable byte size. */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** Human-readable duration (seconds → m:ss). */
export function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export type { DatasetKind }
