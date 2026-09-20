/**
 * Same-origin runtime-asset proxy (ADR-046).
 *
 * In `VITE_ASSETS_MODE=external` builds the heavy runtime assets (module
 * `assets/` trees and the onnxruntime-web wasm runtime) are not copied into
 * `dist/`; they are published to the private R2 bucket `wake-studio-assets`
 * by `scripts/publish-r2.mjs` and served here through the `RUNTIME_ASSETS`
 * binding.
 *
 * The URL layout is deliberately identical to the bundled mode — `/modules/`
 * and `/ort/` — so the app, the model registry and the service worker's
 * runtime caching need no knowledge of where the bytes come from. Object keys
 * mirror the URL paths (`modules/...`, `ort/...`).
 *
 * The helpers are pure (no binding access) except {@link serveAsset}, which
 * takes the binding as a parameter, so they are unit-testable in Node.
 */

import type { Env, R2Object, R2Range } from './r2-types'

/**
 * Cache-Control for asset responses. Mirrors the Pages static-asset default:
 * revalidate with the ETag, but let the browser skip the body. The PWA service
 * worker caches these responses CacheFirst for offline use.
 */
export const ASSET_CACHE_CONTROL = 'public, max-age=0, must-revalidate'

/**
 * Fallback extension -> MIME map for objects uploaded without HTTP metadata.
 * Keep in sync with the map in `scripts/publish-r2.mjs` (which always sets the
 * content type on upload; this is the defensive fallback).
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.onnx': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
}

/** Content type for an object: uploaded metadata wins, then the extension. */
export function contentTypeFor(
  key: string,
  metadata?: { contentType?: string },
): string {
  if (metadata?.contentType) return metadata.contentType
  const dot = key.lastIndexOf('.')
  const ext = dot >= 0 ? key.slice(dot).toLowerCase() : ''
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/**
 * Map catch-all path segments to an R2 object key.
 *
 * Returns null for empty/absent segments and for traversal attempts, so a
 * malformed URL becomes a 404 instead of reaching outside the asset prefix.
 */
export function objectKey(
  prefix: string,
  segments: readonly string[] | undefined,
): string | null {
  if (!segments || segments.length === 0) return null
  for (const segment of segments) {
    if (segment.length === 0) return null
    if (segment === '.' || segment === '..') return null
    if (segment.includes('\\') || segment.includes('\0')) return null
    if (segment.startsWith('/')) return null
  }
  return `${prefix}/${segments.join('/')}`
}

/** Response headers shared by 200/206/304/HEAD responses. */
function objectHeaders(object: R2Object, contentLength?: number): Headers {
  const headers = new Headers()
  headers.set('content-type', contentTypeFor(object.key, object.httpMetadata))
  headers.set(
    'cache-control',
    object.httpMetadata?.cacheControl ?? ASSET_CACHE_CONTROL,
  )
  headers.set('etag', object.httpEtag)
  headers.set('accept-ranges', 'bytes')
  if (contentLength !== undefined) {
    headers.set('content-length', String(contentLength))
  }
  return headers
}

/** Resolve R2's returned range union to an absolute `{ start, length }`. */
function resolveRange(range: R2Range, size: number): { start: number; length: number } {
  if ('suffix' in range) {
    const length = Math.min(range.suffix, size)
    return { start: size - length, length }
  }
  const start = range.offset ?? 0
  return { start, length: range.length ?? size - start }
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 })
}

/**
 * Serve one R2 object for a catch-all asset route.
 *
 * @param request  the incoming request (GET/HEAD; `Range`/`If-None-Match` are
 *                 passed through to R2)
 * @param env      Pages bindings (`RUNTIME_ASSETS` R2 bucket)
 * @param prefix   object-key prefix, e.g. `modules` or `ort`
 * @param segments catch-all path segments after the prefix
 */
export async function serveAsset(
  request: Request,
  env: Env,
  prefix: string,
  segments?: readonly string[],
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    })
  }

  const key = objectKey(prefix, segments)
  if (key === null) return notFound()

  // HEAD: metadata only (registry probes use HEAD for size/availability).
  if (request.method === 'HEAD') {
    const head = await env.RUNTIME_ASSETS.head(key)
    if (head === null) return notFound()
    return new Response(null, {
      status: 200,
      headers: objectHeaders(head, head.size),
    })
  }

  const object = await env.RUNTIME_ASSETS.get(key, {
    range: request.headers,
    onlyIf: request.headers,
  })
  if (object === null) return notFound()

  // R2 answers a satisfied `If-None-Match` with an R2Object that has no body;
  // surface that as 304 (the ETag is the validator the browser keeps).
  if (!('body' in object)) {
    return new Response(null, { status: 304, headers: objectHeaders(object) })
  }

  let contentLength = object.size
  let contentRange: string | undefined
  if (object.range) {
    const { start, length } = resolveRange(object.range, object.size)
    contentLength = length
    contentRange = `bytes ${start}-${start + length - 1}/${object.size}`
  }
  const headers = objectHeaders(object, contentLength)
  if (contentRange) headers.set('content-range', contentRange)
  return new Response(object.body, { status: object.range ? 206 : 200, headers })
}
