import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  validateBundle,
  hasBundleModel,
  importColabBundle,
  importResultBundle,
  isCommerciallyExportable,
  BundleImportError,
  BUNDLE_IMPORT_ERROR_MESSAGES,
} from '../core/manifest'
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

  it('rejects a bundle with an unknown backend', () => {
    const bundle: Partial<ArtifactBundle> = {
      jobId: 'job-1',
      files: {
        metadata: { ...meta('job-1'), backend: 'quantum' as never },
        provenance: { license: 'user-owned' },
      },
    }
    expect(validateBundle(bundle)).toBe(false)
  })

  it('rejects a bundle whose provenance has no license (license-gate input)', () => {
    const bundle: Partial<ArtifactBundle> = {
      jobId: 'job-1',
      files: {
        metadata: meta('job-1'),
        provenance: { license: '' },
      },
    }
    expect(validateBundle(bundle)).toBe(false)
  })

  it('hasBundleModel is false when no model file is present', () => {
    const bundle: Partial<ArtifactBundle> = {
      jobId: 'job-1',
      files: {
        metadata: meta('job-1'),
        provenance: { license: 'user-owned' },
      },
    }
    expect(hasBundleModel(bundle as ArtifactBundle)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// importColabBundle — the 'Import Colab results' flow (docs/modules/training.md §7)
// ---------------------------------------------------------------------------

function colabZip(opts: {
  jobId?: string
  backend?: string
  license?: string
  withModel?: boolean
  withProvenance?: boolean
  withMetadata?: boolean
  prefix?: boolean
  labels?: string[] | unknown
  commercialUse?: boolean
  restrictedBy?: string[]
} = {}): Uint8Array {
  const {
    jobId = 'kws-openwakeword-123',
    backend = 'colab',
    license = 'user-owned',
    withModel = true,
    withProvenance = true,
    withMetadata = true,
    prefix = true,
    labels,
    commercialUse,
    restrictedBy,
  } = opts
  const files: Record<string, Uint8Array> = {}
  const put = (name: string, obj: unknown) => {
    const key = prefix ? `${jobId}/${name}` : name
    files[key] = obj instanceof Uint8Array ? obj : strToU8(JSON.stringify(obj))
  }
  if (withMetadata) {
    put('metadata.json', {
      jobId,
      moduleId: 'kws-openwakeword',
      backend,
      provider: 'colab',
      params: { wakePhrase: 'hey studio', target: 'app-class', epochs: '10000' },
      trainedAtMs: 42,
    })
  }
  if (withProvenance) {
    put('provenance.json', {
      license,
      // #210: the inherited restriction (optional; absent on pre-#210 bundles).
      ...(commercialUse === undefined ? {} : { commercialUse }),
      ...(restrictedBy ? { restrictedBy } : {}),
      sourceData: [{ name: 'piper-sample-generator synthetic speech', license: 'MIT', source: 'https://github.com/rhasspy/piper-sample-generator' }],
      notes: 'Trained from synthetic TTS audio.',
    })
  }
  if (withModel) {
    put('model.onnx', strToU8('fake-onnx-bytes'))
    put('model.tflite', strToU8('fake-tflite-bytes'))
  }
  put('metrics.json', { recall: 0.9, accuracy: 0.8, steps: 10000 })
  put('config.json', { wakePhrase: 'hey studio', target: 'app-class' })
  if (labels !== undefined) {
    put('labels.json', labels)
  }
  return zipSync(files, { level: 0 })
}

describe('importColabBundle (the PWA Colab-results importer)', () => {
  it('imports a well-formed notebook bundle (job-id-prefixed entries)', async () => {
    const zip = colabZip()

    const bundle = await importColabBundle(zip)

    expect(validateBundle(bundle)).toBe(true)
    expect(hasBundleModel(bundle)).toBe(true)
    expect(bundle.jobId).toBe('kws-openwakeword-123')
    expect(bundle.files.metadata.backend).toBe('colab')
    expect(bundle.files.metadata.params.wakePhrase).toBe('hey studio')
    expect(bundle.files.provenance.license).toBe('user-owned')
    expect(bundle.files.metrics?.accuracy).toBe(0.8)
    expect(bundle.files.configSnapshot?.target).toBe('app-class')
    expect(bundle.files.model?.byteLength).toBe('fake-onnx-bytes'.length)
  })

  it('imports labels.json into bundle.files.labels + metadata.labels (ADR-039)', async () => {
    const zip = colabZip({ labels: ['yes', 'no'] })
    const bundle = await importColabBundle(zip)
    expect(bundle.files.labels).toEqual(['yes', 'no'])
    expect(bundle.files.metadata.labels).toEqual(['yes', 'no'])
  })

  it('still imports a bundle without labels.json (back-compat, pre-ADR-039)', async () => {
    const zip = colabZip()
    const bundle = await importColabBundle(zip)
    expect(bundle.files.labels).toBeUndefined()
    expect(bundle.files.metadata.labels).toBeUndefined()
  })

  it('rejects an empty labels.json (invalid-labels)', async () => {
    const zip = colabZip({ labels: [] })
    await expect(importColabBundle(zip)).rejects.toMatchObject({ code: 'invalid-labels' })
  })

  it('rejects labels.json with a non-string entry (invalid-labels)', async () => {
    const zip = colabZip({ labels: ['yes', 42] })
    await expect(importColabBundle(zip)).rejects.toMatchObject({ code: 'invalid-labels' })
  })

  it('rejects labels.json whose entries are blank strings (invalid-labels)', async () => {
    const zip = colabZip({ labels: ['yes', '   '] })
    await expect(importColabBundle(zip)).rejects.toMatchObject({ code: 'invalid-labels' })
  })

  it('tolerates entries NOT prefixed by the job id (flat layout)', async () => {
    const zip = colabZip({ prefix: false })
    const bundle = await importColabBundle(zip)
    expect(bundle.jobId).toBe('kws-openwakeword-123')
  })

  it('rejects a zip without metadata.json (missing-metadata)', async () => {
    const zip = colabZip({ withMetadata: false })
    await expect(importColabBundle(zip)).rejects.toMatchObject({
      name: 'BundleImportError',
      code: 'missing-metadata',
      message: BUNDLE_IMPORT_ERROR_MESSAGES['missing-metadata'],
    })
  })

  it('rejects a zip without provenance.json (missing-provenance)', async () => {
    const zip = colabZip({ withProvenance: false })
    await expect(importColabBundle(zip)).rejects.toMatchObject({ code: 'missing-provenance' })
  })

  it('imports a self-hosted (studio-backend) bundle too (one importer, all backends)', async () => {
    const zip = colabZip({ backend: 'self-hosted' })
    const bundle = await importColabBundle(zip)
    expect(bundle.files.metadata.backend).toBe('self-hosted')
    expect(bundle.jobId).toBe('kws-openwakeword-123')
  })

  it('rejects metadata with an unknown backend (invalid-metadata)', async () => {
    const zip = colabZip({ backend: 'quantum' })
    await expect(importColabBundle(zip)).rejects.toMatchObject({ code: 'invalid-metadata' })
  })

  it('importResultBundle is the same single importer (alias)', async () => {
    const zip = colabZip({ backend: 'self-hosted' })
    const bundle = await importResultBundle(zip)
    expect(bundle.files.metadata.backend).toBe('self-hosted')
  })

  it('rejects metadata without a job id (invalid-metadata)', async () => {
    const zip = colabZip({ jobId: '' })
    await expect(importColabBundle(zip)).rejects.toMatchObject({ code: 'invalid-metadata' })
  })

  it('rejects provenance without a license (invalid-provenance)', async () => {
    const zip = colabZip({ license: '' })
    await expect(importColabBundle(zip)).rejects.toMatchObject({ code: 'invalid-provenance' })
  })

  it('rejects a bundle with no model file (missing-model)', async () => {
    const zip = colabZip({ withModel: false })
    await expect(importColabBundle(zip)).rejects.toMatchObject({ code: 'missing-model' })
  })

  it('rejects a non-zip input (no-zip)', async () => {
    const notAZip = new Uint8Array([1, 2, 3, 4, 5])
    await expect(importColabBundle(notAZip)).rejects.toMatchObject({ code: 'no-zip' })
  })

  it('rejects an empty input (no-zip)', async () => {
    await expect(importColabBundle(new Uint8Array(0))).rejects.toMatchObject({ code: 'no-zip' })
  })

  it('throws a typed BundleImportError instance', async () => {
    const zip = colabZip({ withProvenance: false })
    try {
      await importColabBundle(zip)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(BundleImportError)
      expect((err as BundleImportError).code).toBe('missing-provenance')
    }
  })
})

describe('provenance inheritance / export gate input (#210)', () => {
  it('imports the inherited commercialUse + restrictedBy from provenance.json', async () => {
    const zip = colabZip({
      license: 'research-only',
      commercialUse: false,
      restrictedBy: ['research corpus'],
    })
    const bundle = await importColabBundle(zip)
    expect(bundle.files.provenance.commercialUse).toBe(false)
    expect(bundle.files.provenance.restrictedBy).toEqual(['research corpus'])
    expect(bundle.files.provenance.license).toBe('research-only')
    expect(isCommerciallyExportable(bundle.files.provenance)).toBe(false)
  })

  it('leaves the inherited fields undefined on pre-#210 bundles', async () => {
    const zip = colabZip() // no commercialUse / restrictedBy
    const bundle = await importColabBundle(zip)
    expect(bundle.files.provenance.commercialUse).toBeUndefined()
    expect(bundle.files.provenance.restrictedBy).toBeUndefined()
    // fall back to the historical user-owned convention
    expect(isCommerciallyExportable(bundle.files.provenance)).toBe(true)
  })

  it('isCommerciallyExportable: user-owned is exportable', () => {
    expect(isCommerciallyExportable({ license: 'user-owned' })).toBe(true)
    expect(
      isCommerciallyExportable({ license: 'user-owned', commercialUse: true }),
    ).toBe(true)
  })

  it('isCommerciallyExportable: a research-only dataset restricts the whole model', () => {
    expect(
      isCommerciallyExportable({ license: 'research-only', commercialUse: false }),
    ).toBe(false)
    expect(
      isCommerciallyExportable({
        license: 'user-owned',
        commercialUse: false,
        restrictedBy: ['research corpus'],
      }),
    ).toBe(false)
    expect(
      isCommerciallyExportable({ license: 'user-owned', restrictedBy: ['nc-sa'] }),
    ).toBe(false)
  })
})
