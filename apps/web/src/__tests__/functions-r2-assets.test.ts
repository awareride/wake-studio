/**
 * Pages Functions R2 asset proxy tests (ADR-046).
 *
 * The proxy is pure except for the R2 binding, which is injected, so the
 * GET/HEAD/Range/304 behaviour is unit-testable in Node without workerd.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ASSET_CACHE_CONTROL,
  CONTENT_TYPES,
  contentTypeFor,
  objectKey,
  serveAsset,
} from '../../functions/_lib/r2-assets'
import type {
  R2BucketLike,
  R2Object,
  R2ObjectBody,
} from '../../functions/_lib/r2-types'

interface FakeFile {
  text: string
  contentType?: string
}

const ETAG = '"test-etag"'

function meta(key: string, file: FakeFile): R2Object {
  return {
    key,
    size: Buffer.byteLength(file.text),
    httpEtag: ETAG,
    httpMetadata: file.contentType ? { contentType: file.contentType } : undefined,
  }
}

/** Minimal R2 stub: one object per key, byte-range aware. */
function fakeBucket(files: Record<string, FakeFile>): R2BucketLike {
  return {
    async head(key) {
      const file = files[key]
      return file ? meta(key, file) : null
    },
    async get(key, options): Promise<R2ObjectBody | R2Object | null> {
      const file = files[key]
      if (!file) return null

      const raw = options?.range?.get('range')
      const closed = raw ? /^bytes=(\d+)-(\d*)$/.exec(raw) : null
      const suffix = raw ? /^bytes=-(\d+)$/.exec(raw) : null
      if (suffix) {
        const n = Number(suffix[1])
        const start = Math.max(0, file.text.length - n)
        const slice = file.text.slice(start)
        return {
          ...meta(key, file),
          range: { suffix: n },
          body: new Blob([slice]).stream(),
        }
      }
      if (closed) {
        const offset = Number(closed[1])
        const end = closed[2] ? Number(closed[2]) : file.text.length - 1
        const slice = file.text.slice(offset, end + 1)
        return {
          ...meta(key, file),
          range: { offset, length: Buffer.byteLength(slice) },
          body: new Blob([slice]).stream(),
        }
      }
      return { ...meta(key, file), body: new Blob([file.text]).stream() }
    },
  }
}

/** Stub that simulates R2's conditional-request miss (object without body). */
function conditionalMissBucket(): R2BucketLike {
  return {
    async head(key) {
      return meta(key, { text: 'x' })
    },
    async get(key) {
      return meta(key, { text: 'x' })
    },
  }
}

describe('objectKey (traversal guard)', () => {
  it('joins catch-all segments under the prefix', () => {
    expect(objectKey('modules', ['kws', 'sherpa', 'a.wasm'])).toBe(
      'modules/kws/sherpa/a.wasm',
    )
  })

  it('returns null for missing/empty segment lists', () => {
    expect(objectKey('modules', undefined)).toBeNull()
    expect(objectKey('modules', [])).toBeNull()
    expect(objectKey('modules', [''])).toBeNull()
  })

  it('rejects traversal and malformed segments', () => {
    expect(objectKey('modules', ['..', 'secret'])).toBeNull()
    expect(objectKey('modules', ['.'])).toBeNull()
    expect(objectKey('modules', ['a\\b'])).toBeNull()
    expect(objectKey('modules', ['/etc/passwd'])).toBeNull()
    expect(objectKey('modules', ['a\0b'])).toBeNull()
  })
})

describe('contentTypeFor', () => {
  it('prefers uploaded HTTP metadata', () => {
    expect(contentTypeFor('x.bin', { contentType: 'application/x-custom' })).toBe(
      'application/x-custom',
    )
  })

  it('falls back to the extension map', () => {
    expect(contentTypeFor('a/b.wasm')).toBe('application/wasm')
    expect(contentTypeFor('a/b.onnx')).toBe('application/octet-stream')
    expect(contentTypeFor('a/b.data')).toBe('application/octet-stream')
    expect(contentTypeFor('a/b.json')).toBe('application/json')
    expect(contentTypeFor('a/b.mjs')).toBe('text/javascript')
  })

  it('defaults to octet-stream for unknown extensions', () => {
    expect(contentTypeFor('a/b.unknown')).toBe('application/octet-stream')
    expect(contentTypeFor('no-extension')).toBe('application/octet-stream')
  })
})

describe('serveAsset', () => {
  const env = {
    RUNTIME_ASSETS: fakeBucket({
      'modules/kws/sherpa/assets/a.wasm': {
        text: '0123456789',
        contentType: 'application/wasm',
      },
    }),
  }

  it('rejects non-GET/HEAD methods', async () => {
    const res = await serveAsset(
      new Request('https://wake-studio.test/modules/a', { method: 'POST' }),
      env,
      'modules',
      ['a'],
    )
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  it('404s on a missing object', async () => {
    const res = await serveAsset(
      new Request('https://wake-studio.test/modules/missing'),
      env,
      'modules',
      ['missing'],
    )
    expect(res.status).toBe(404)
  })

  it('404s (without touching R2) on traversal segments', async () => {
    const res = await serveAsset(
      new Request('https://wake-studio.test/modules/..%2Fsecret'),
      env,
      'modules',
      ['..', 'secret'],
    )
    expect(res.status).toBe(404)
  })

  it('serves a full object with metadata headers', async () => {
    const res = await serveAsset(
      new Request('https://wake-studio.test/modules/kws/sherpa/assets/a.wasm'),
      env,
      'modules',
      ['kws', 'sherpa', 'assets', 'a.wasm'],
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/wasm')
    expect(res.headers.get('content-length')).toBe('10')
    expect(res.headers.get('etag')).toBe(ETAG)
    expect(res.headers.get('cache-control')).toBe(ASSET_CACHE_CONTROL)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(await res.text()).toBe('0123456789')
  })

  it('answers HEAD with metadata and no body', async () => {
    const res = await serveAsset(
      new Request('https://wake-studio.test/ort/x.wasm', { method: 'HEAD' }),
      { RUNTIME_ASSETS: fakeBucket({ 'ort/x.wasm': { text: 'abcd' } }) },
      'ort',
      ['x.wasm'],
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('4')
    expect(await res.text()).toBe('')
  })

  it('serves a byte range as 206 with content-range', async () => {
    const res = await serveAsset(
      new Request('https://wake-studio.test/modules/kws/sherpa/assets/a.wasm', {
        headers: { range: 'bytes=2-5' },
      }),
      env,
      'modules',
      ['kws', 'sherpa', 'assets', 'a.wasm'],
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(res.headers.get('content-length')).toBe('4')
    expect(await res.text()).toBe('2345')
  })

  it('returns 304 when R2 short-circuits a conditional request', async () => {
    const res = await serveAsset(
      new Request('https://wake-studio.test/ort/x.wasm', {
        headers: { 'if-none-match': ETAG },
      }),
      { RUNTIME_ASSETS: conditionalMissBucket() },
      'ort',
      ['x.wasm'],
    )
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe(ETAG)
    expect(await res.text()).toBe('')
  })

  it('serves an open-ended range as 206 with content-range', async () => {
    const res = await serveAsset(
      new Request('https://wake-studio.test/modules/kws/sherpa/assets/a.wasm', {
        headers: { range: 'bytes=7-' },
      }),
      env,
      'modules',
      ['kws', 'sherpa', 'assets', 'a.wasm'],
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 7-9/10')
    expect(await res.text()).toBe('789')
  })

  it('serves a suffix range as 206 with content-range', async () => {
    const res = await serveAsset(
      new Request('https://wake-studio.test/modules/kws/sherpa/assets/a.wasm', {
        headers: { range: 'bytes=-4' },
      }),
      env,
      'modules',
      ['kws', 'sherpa', 'assets', 'a.wasm'],
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 6-9/10')
    expect(await res.text()).toBe('6789')
  })

  it('answers conditional HEAD with 304 when the ETag matches', async () => {
    const res = await serveAsset(
      new Request('https://wake-studio.test/ort/x.wasm', {
        method: 'HEAD',
        headers: { 'if-none-match': ETAG },
      }),
      { RUNTIME_ASSETS: fakeBucket({ 'ort/x.wasm': { text: 'abcd' } }) },
      'ort',
      ['x.wasm'],
    )
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe(ETAG)
    expect(await res.text()).toBe('')
  })

  it('answers conditional HEAD with 200 when the ETag differs', async () => {
    const res = await serveAsset(
      new Request('https://wake-studio.test/ort/x.wasm', {
        method: 'HEAD',
        headers: { 'if-none-match': '"other-etag"' },
      }),
      { RUNTIME_ASSETS: fakeBucket({ 'ort/x.wasm': { text: 'abcd' } }) },
      'ort',
      ['x.wasm'],
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('4')
  })
})

describe('publish/serve MIME map sync', () => {
  it('CONTENT_TYPES matches scripts/publish-r2.mjs', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const script = readFileSync(
      join(here, '..', '..', '..', '..', 'scripts', 'publish-r2.mjs'),
      'utf8',
    )
    const pairs = [...script.matchAll(/'(\.[a-z0-9]+)'\s*:\s*'([^']+)'/g)]
    expect(pairs.length).toBeGreaterThan(0)
    const scriptMap = Object.fromEntries(pairs.map((m) => [m[1], m[2]]))
    expect(scriptMap).toEqual({ ...CONTENT_TYPES })
  })
})
