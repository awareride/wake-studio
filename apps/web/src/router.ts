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
  | 'playground-rnnoise'
  | 'settings'
  | 'device-sdk'

export const DEFAULT_ROUTE: ConsoleRoute = 'workspace'

const ROUTE_BY_HASH: Record<string, ConsoleRoute> = {
  '/workspace': 'workspace',
  '/library': 'library',
  '/projects': 'projects',
  '/playground/rnnoise': 'playground-rnnoise',
  '/settings': 'settings',
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
    case 'playground-rnnoise':
      return '/playground/rnnoise'
    case 'settings':
      return '/settings'
    case 'device-sdk':
      return '/device-sdk'
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
