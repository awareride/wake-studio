/**
 * Minimal structural types for the R2 binding used by the asset Functions
 * (ADR-046). Declared locally so the web app does not need a
 * `@cloudflare/workers-types` dependency for a thin read-only proxy; swap for
 * the generated `wrangler types` output if the Functions grow beyond this.
 */

export interface R2HttpMetadata {
  contentType?: string
  cacheControl?: string
}

/** Present when the request carried a satisfiable `Range` header. */
export type R2Range =
  | { offset: number; length?: number }
  | { offset?: number; length: number }
  | { suffix: number }

export interface R2Object {
  key: string
  size: number
  /** ETag including weak-validator quotes; safe to send as `ETag`. */
  httpEtag: string
  httpMetadata?: R2HttpMetadata
  range?: R2Range
}

/** `get()` returns this shape when a body is available. */
export interface R2ObjectBody extends R2Object {
  body: ReadableStream
}

export interface R2GetOptions {
  /** `Range` header passthrough (R2 slices the object for us). */
  range?: Headers
  /** `If-None-Match` / `If-Modified-Since` passthrough (R2 answers 304). */
  onlyIf?: Headers
}

export interface R2BucketLike {
  get(
    key: string,
    options?: R2GetOptions,
  ): Promise<R2ObjectBody | R2Object | null>
  head(key: string): Promise<R2Object | null>
}

/** Bindings available to the asset Functions (see apps/web/wrangler.toml). */
export interface Env {
  /**
   * R2 bucket with the heavy runtime assets. Named RUNTIME_ASSETS because
   * `ASSETS` is reserved by Pages Functions for the static build fetcher
   * (`env.ASSETS.fetch()`).
   */
  RUNTIME_ASSETS: R2BucketLike
}

/** Context for a `[[path]]` catch-all route: `params.path` is the segment list. */
export interface CatchAllPagesContext {
  request: Request
  env: Env
  params: { path?: string[] }
}
