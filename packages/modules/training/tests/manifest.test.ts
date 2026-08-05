import { describe, it, expect } from 'vitest'
import { validateBundle } from '../core/manifest'
import type { ArtifactBundle } from '../core/manifest'

function meta(jobId: string) {
  return {
    jobId,
    moduleId: 'kws-openwakeword',
    backend: 'self-hosted' as const,
    params: {},
    trainedAtMs: 0,
  }
}

describe('training artifact bundle manifest (contract, docs/modules/training.md §4)', () => {
  it('validates a well-formed bundle', () => {
    const bundle: Partial<ArtifactBundle> = {
      jobId: 'job-1',
      files: {
        metadata: meta('job-1'),
        provenance: { license: 'user-owned' },
      },
    }
    expect(validateBundle(bundle)).toBe(true)
  })

  it('rejects a bundle missing provenance (license gate input)', () => {
    const bundle = {
      jobId: 'job-1',
      files: { metadata: meta('job-1') },
    } as unknown as Partial<ArtifactBundle>
    expect(validateBundle(bundle)).toBe(false)
  })

  it('rejects a bundle missing the job id', () => {
    const bundle: Partial<ArtifactBundle> = {
      files: {
        metadata: meta(''),
        provenance: { license: 'user-owned' },
      },
    }
    expect(validateBundle(bundle)).toBe(false)
  })
})
