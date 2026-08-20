/**
 * Studio-backend client tests (issue #122, ADR-036).
 *
 * The client is pure fetch-based; tests mock global fetch (and rely on the
 * polling fallback path — Node has no EventSource, so subscribe() exercises
 * the polling transport, which is the compatible baseline).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createStudioClient,
  studioJobPatch,
  type StudioJob,
} from '../studio-client'

const JOB: StudioJob = {
  id: 'train-1',
  moduleId: 'kws-openwakeword',
  params: { wakePhrase: 'hey studio' },
  status: 'running',
  progress: 0.42,
  metrics: { loss: 0.12 },
  logTail: ['{"event":"progress","progress":0.42}'],
  error: null,
  exitCode: null,
  createdAtMs: 1,
  updatedAtMs: 2,
  startedAtMs: 1,
  finishedAtMs: null,
  pid: 42,
  checkpoint: null,
  artifacts: [],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('createStudioClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes the base URL (strips trailing slashes)', () => {
    const client = createStudioClient('http://127.0.0.1:4824///')
    expect(client.baseUrl).toBe('http://127.0.0.1:4824')
  })

  it('createJob POSTs to /jobs with moduleId, params, id and Bearer token', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(JOB))
    const client = createStudioClient('http://127.0.0.1:4824', 'sekrit')

    const job = await client.createJob('kws-openwakeword', { wakePhrase: 'hey' }, 'train-1')

    expect(job.id).toBe('train-1')
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4824/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sekrit',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          moduleId: 'kws-openwakeword',
          params: { wakePhrase: 'hey' },
          id: 'train-1',
        }),
      }),
    )
  })

  it('does not send an Authorization header when no token is set', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(JOB))
    const client = createStudioClient('http://127.0.0.1:4824')
    await client.getJob('train-1')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('http://127.0.0.1:4824/jobs/train-1')
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('listJobs unwraps the {jobs: [...]} envelope', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ jobs: [JOB] }))
    const jobs = await createStudioClient('http://x').listJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].id).toBe('train-1')
  })

  it('listDatasets unwraps the {datasets: [...]} envelope (feeds the picker, #206)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        datasets: [
          {
            id: 'ds-1',
            name: 'wake-words',
            version: 1,
            kind: 'generated',
            role: 'mixed',
            sizeBytes: 1024,
            createdAtMs: 1,
            manifest: {
              audio: { sampleRate: 16000, channels: 1, clips: 4, durationSec: 8 },
              labels: [{ name: 'hey_studio', role: 'positive' }],
              provenance: [],
            },
          },
        ],
      }),
    )
    const datasets = await createStudioClient('http://x').listDatasets()
    expect(datasets).toHaveLength(1)
    expect(datasets[0].id).toBe('ds-1')
    expect(datasets[0].manifest.labels?.[0].role).toBe('positive')
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('http://x/datasets')
  })

  it('surfaces backend errors as StudioClientError with the status', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'no such job' }, 404))
    await expect(createStudioClient('http://x').getJob('nope')).rejects.toMatchObject({
      name: 'StudioClientError',
      status: 404,
    })
  })

  it('surfaces network failures as StudioClientError with status 0', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'))
    await expect(createStudioClient('http://x').getJob('train-1')).rejects.toMatchObject({
      name: 'StudioClientError',
      status: 0,
    })
  })

  it('lifecycle actions call the right route', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse(JOB)))
    const client = createStudioClient('http://x')
    await client.pauseJob('train-1')
    await client.cancelJob('train-1')
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => u)
    expect(urls[0]).toBe('http://x/jobs/train-1/pause')
    expect(urls[1]).toBe('http://x/jobs/train-1/cancel')
  })

  it('artifactUrl points at the sha256-served artifact endpoint', () => {
    const client = createStudioClient('http://x')
    expect(client.artifactUrl('train-1', 'model.onnx')).toBe(
      'http://x/artifacts/train-1/model.onnx',
    )
  })

  it('subscribe falls back to polling (no EventSource in Node) and pushes jobs', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse(JOB)))
    const client = createStudioClient('http://x')
    const seen: StudioJob[] = []
    let mode: string | undefined
    const unsubscribe = client.subscribe(
      'train-1',
      (j) => seen.push(j),
      (m) => (mode = m),
    )

    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))
    expect(seen[0].id).toBe('train-1')
    expect(mode).toBe('polling')
    unsubscribe()
  })
})

describe('studioJobPatch', () => {
  it('maps live backend fields onto a HistoryJob patch (undefined for null)', () => {
    const patch = studioJobPatch(JOB)
    expect(patch.status).toBe('running')
    expect(patch.progress).toBe(0.42)
    expect(patch.error).toBeUndefined()
    expect(patch.finishedAtMs).toBeUndefined()
    expect(patch.metrics).toEqual({ loss: 0.12 })
    expect(patch.logTail).toEqual(JOB.logTail)
  })
})
