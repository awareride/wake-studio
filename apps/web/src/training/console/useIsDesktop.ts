/**
 * useIsDesktop — matches the Tailwind `lg` breakpoint (1024px), mirroring
 * the shell's desktop-vs-mobile sidebar behavior (issue #105).
 */

import { useEffect, useState } from 'react'

const QUERY = '(min-width: 1024px)'

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = () => setIsDesktop(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isDesktop
}