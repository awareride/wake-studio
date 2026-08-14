/**
 * Hash-based routing hook (zero dependencies; static-host safe).
 *
 * Views are keyed by hash path, e.g. `#/workspace`, `#/library`,
 * `#/projects`, `#/playground/rnnoise`. Deep-linkable and bookmarkable.
 * Unknown hashes fall back to the default view.
 *
 * Sub-route hashes: `#/settings/modules/<backendId>` keeps the Settings
 * Modules view focused on a driver; `#/training/new[/<step>]` opens the
 * New-train wizard (each step is its own history entry so browser back
 * walks the steps, issue #136); `#/training/review/<jobId>` and
 * `#/backends/new|colab[/preview]` are back-closeable sub-panels.
 */

import * as React from 'react'

export type ConsoleRoute =
  | 'workspace'
  | 'library'
  | 'training'
  | 'backends'
  | 'projects'
  | 'console'
  | 'playground-rnnoise'
  | 'settings'
  | 'settings-general'
  | 'settings-security'
  | 'settings-data'
  | 'settings-modules'
  | 'device-sdk'

/** Settings sub-views (driven from the sidebar sub-menu). */
export type SettingsSection = 'general' | 'security' | 'data' | 'modules'

export const DEFAULT_ROUTE: ConsoleRoute = 'workspace'

const ROUTE_BY_HASH: Record<string, ConsoleRoute> = {
  '/workspace': 'workspace',
  '/library': 'library',
  '/training': 'training',
  '/backends': 'backends',
  '/projects': 'projects',
  '/console': 'console',
  '/playground/rnnoise': 'playground-rnnoise',
  '/settings': 'settings',
  '/settings/general': 'settings-general',
  '/settings/security': 'settings-security',
  '/settings/data': 'settings-data',
  '/settings/modules': 'settings-modules',
  '/device-sdk': 'device-sdk',
  '': 'workspace',
  '/': 'workspace',
}

/**
 * Parse the settings backend anchor from the hash, e.g.
 * `#/settings/modules/plixkws` -> 'plixkws'. Used to keep focus on the
 * driver the user clicked in the sidebar (Settings -> driver).
 */
export function settingsBackendFromHash(hash: string): string | undefined {
  const raw = hash.replace(/^#/, '')
  const prefix = '/settings/modules/'
  if (!raw.startsWith(prefix)) return undefined
  const id = raw.slice(prefix.length).split('/')[0]
  return id || undefined
}

/**
 * Build the settings hash for a section, optionally anchored to a driver
 * (e.g. `/settings/modules/plixkws`).
 */
export function settingsHash(section: SettingsSection, backendId?: string): string {
  const base = routeToHash(settingsRoute(section))
  return backendId ? `${base}/${backendId}` : base
}

/** Map a route to its canonical hash (without the leading '#'). */
export function routeToHash(route: ConsoleRoute): string {
  switch (route) {
    case 'workspace':
      return '/workspace'
    case 'library':
      return '/library'
    case 'training':
      return '/training'
    case 'backends':
      return '/backends'
    case 'projects':
      return '/projects'
    case 'console':
      return '/console'
    case 'playground-rnnoise':
      return '/playground/rnnoise'
    case 'settings':
      return '/settings/general'
    case 'settings-general':
      return '/settings/general'
    case 'settings-security':
      return '/settings/security'
    case 'settings-data':
      return '/settings/data'
    case 'settings-modules':
      return '/settings/modules'
    case 'device-sdk':
      return '/device-sdk'
  }
}

/** Map a SettingsSection to its ConsoleRoute. */
export function settingsRoute(section: SettingsSection): ConsoleRoute {
  switch (section) {
    case 'general':
      return 'settings-general'
    case 'security':
      return 'settings-security'
    case 'data':
      return 'settings-data'
    case 'modules':
      return 'settings-modules'
  }
}

/** Map a ConsoleRoute back to its SettingsSection (or undefined). */
export function settingsSectionOf(route: ConsoleRoute): SettingsSection | undefined {
  switch (route) {
    case 'settings-general':
      return 'general'
    case 'settings-security':
      return 'security'
    case 'settings-data':
      return 'data'
    case 'settings-modules':
      return 'modules'
    default:
      return undefined
  }
}

/** Hash prefix of the New-train wizard full panel: `#/training/new[/<step>]`. */
export const TRAIN_NEW_HASH_PREFIX = '/training/new'

/**
 * The New-train wizard step embedded in the hash, if any.
 * `#/training/new` (no step) means the wizard's first step; this returns
 * `undefined` for it and for any non-wizard hash.
 */
export function trainNewStepFromHash(hash: string): string | undefined {
  const raw = hash.replace(/^#/, '')
  if (!raw.startsWith(`${TRAIN_NEW_HASH_PREFIX}/`)) return undefined
  return raw.slice(TRAIN_NEW_HASH_PREFIX.length + 1).split('/')[0] || undefined
}

/** True for a New-train wizard review hash, e.g. `#/training/new/ready/review`. */
export function trainNewReviewFromHash(hash: string): boolean {
  const raw = hash.replace(/^#/, '')
  return raw.startsWith(`${TRAIN_NEW_HASH_PREFIX}/`) && raw.endsWith('/review')
}

/** Hash prefix of a train-details notebook review: `#/training/review/<jobId>`. */
export const TRAIN_REVIEW_HASH_PREFIX = '/training/review'

/** The train job id embedded in a review hash, e.g. `#/training/review/train-…`. */
export function trainReviewJobFromHash(hash: string): string | undefined {
  const raw = hash.replace(/^#/, '')
  if (!raw.startsWith(`${TRAIN_REVIEW_HASH_PREFIX}/`)) return undefined
  return raw.slice(TRAIN_REVIEW_HASH_PREFIX.length + 1).split('/')[0] || undefined
}

/** Hash prefix of the Backends view sub-panels: `#/backends/new|colab[/preview]`. */
export const BACKENDS_HASH_PREFIX = '/backends'

/** Backends sub-route embedded in the hash, e.g. 'new', 'colab', 'colab/preview'. */
export function backendsSubFromHash(hash: string): string | undefined {
  const raw = hash.replace(/^#/, '')
  if (!raw.startsWith(`${BACKENDS_HASH_PREFIX}/`)) return undefined
  return raw.slice(BACKENDS_HASH_PREFIX.length + 1)
}

function parseHash(): ConsoleRoute {
  const raw = window.location.hash.replace(/^#/, '')
  // /training/new[/<step>] and /training/review/<jobId> live inside Training.
  if (raw.startsWith(TRAIN_NEW_HASH_PREFIX)) return 'training'
  if (raw.startsWith(TRAIN_REVIEW_HASH_PREFIX)) return 'training'
  // /backends/new|colab[/preview] are Backends full-panel modes.
  if (raw.startsWith(`${BACKENDS_HASH_PREFIX}/`)) return 'backends'
  // /settings/modules/<backendId> also maps to settings-modules.
  if (raw.startsWith('/settings/modules/')) return 'settings-modules'
  return ROUTE_BY_HASH[raw] ?? DEFAULT_ROUTE
}

export function useConsoleRoute(): [ConsoleRoute, (route: ConsoleRoute) => void] {
  const [route, setRoute] = React.useState<ConsoleRoute>(() =>
    typeof window === 'undefined' ? DEFAULT_ROUTE : parseHash(),
  )

  React.useEffect(() => {
    const onHashChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = React.useCallback((next: ConsoleRoute) => {
    const hash = routeToHash(next)
    if (window.location.hash !== `#${hash}`) {
      window.location.hash = hash
    } else {
      // Same hash: still update state (e.g. first mount / manual re-nav).
      setRoute(next)
    }
  }, [])

  return [route, navigate]
}
