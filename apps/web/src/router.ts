/**
 * Hash-based routing hook (zero dependencies; static-host safe).
 *
 * Views are keyed by hash path, e.g. `#/workspace`, `#/library`,
 * `#/projects`, `#/playground/rnnoise`. Deep-linkable and bookmarkable.
 * Unknown hashes fall back to the default view.
 */

import * as React from 'react'

export type ConsoleRoute =
  | 'workspace'
  | 'library'
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

/** Map a route to its canonical hash (without the leading '#'). */
export function routeToHash(route: ConsoleRoute): string {
  switch (route) {
    case 'workspace':
      return '/workspace'
    case 'library':
      return '/library'
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

function parseHash(): ConsoleRoute {
  const raw = window.location.hash.replace(/^#/, '')
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
