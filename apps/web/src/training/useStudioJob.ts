/**
 * useStudioJob — live tracking of a studio-backend job (issue #122).
 *
 * Subscribes to a backend job (SSE /stream when available, polling
 * fallback — see StudioClient.subscribe) and exposes lifecycle actions
 * (start/pause/resume/cancel/delete) plus a manual refresh. The endpoint
 * is the Settings `backend.endpoint` for self-hosted jobs or the Colab
 * tunnel URL; the token is the Settings secret (Bearer on mutations only).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createStudioClient, type StudioClient, type StudioJob } from './studio-client'

const ACTIVE_STATUSES = new Set(['queued', 'running', 'paused'])

export type StudioLiveMode = 'idle' | 'sse' | 'polling'

export interface UseStudioJobOptions {
  jobId?: string
  endpoint?: string
  token?: string
  /** Gate the subscription (e.g. only while the job is active). */
  enabled?: boolean
}

export function useStudioJob({ jobId, endpoint, token, enabled = true }: UseStudioJobOptions) {
  const client = useMemo<StudioClient | null>(
    () => (endpoint ? createStudioClient(endpoint, token) : null),
    [endpoint, token],
  )
  const [live, setLive] = useState<StudioJob | null>(null)
  const [mode, setMode] = useState<StudioLiveMode>('idle')
  const [error, setError] = useState<string | null>(null)
  const activeRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!client || !jobId) return
    try {
      setLive(await client.getJob(jobId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client, jobId])

  useEffect(() => {
    if (!client || !jobId || !enabled) {
      setLive(null)
      setMode('idle')
      return
    }
    // Keep the client from churning on every render: subscribe once per
    // (client, jobId), stop when the component unmounts or inputs change.
    activeRef.current = true
    const onJob = (job: StudioJob) => {
      if (!activeRef.current) return
      setLive(job)
      setError(null)
    }
    const unsubscribe = client.subscribe(jobId, onJob, (m) => setMode(m))
    return () => {
      activeRef.current = false
      unsubscribe()
    }
  }, [client, jobId, enabled])

  const runAction = useCallback(
    (action: 'start' | 'pause' | 'resume' | 'cancel' | 'delete') => async () => {
      if (!client || !jobId) return
      try {
        setError(null)
        if (action === 'delete') {
          await client.deleteJob(jobId)
          setLive(null)
          return
        }
        const method =
          ({ start: 'startJob', pause: 'pauseJob', resume: 'resumeJob', cancel: 'cancelJob' } as const)[action]
        setLive(await client[method](jobId))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [client, jobId],
  )

  const actions = useMemo(
    () => ({
      start: runAction('start'),
      pause: runAction('pause'),
      resume: runAction('resume'),
      cancel: runAction('cancel'),
      delete: runAction('delete'),
      refresh,
      artifactUrl: (jobId: string, name: string) =>
        client ? client.artifactUrl(jobId, name) : '',
    }),
    [runAction, refresh, client],
  )

  return { live, mode, error, actions, client }
}

/** True when a status still has live backend activity to track. */
export function isActiveStatus(status: string | undefined): boolean {
  return !!status && ACTIVE_STATUSES.has(status)
}
