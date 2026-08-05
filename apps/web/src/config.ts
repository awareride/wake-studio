/**
 * App base-path config (ADR-012).
 *
 * GitHub Pages project sites serve under a sub-path (`/<repo>/`), Cloudflare
 * at root. Vite injects the base into `import.meta.env.BASE_URL`; all
 * absolute app URLs (`/prebuilts/...`, `/sherpa-onnx-kws/...`, registry)
 * must be built from this so they survive sub-path deployment.
 */

/** The deploy base path, e.g. `/` or `/wake-studio/`. */
export const APP_BASE: string = import.meta.env.BASE_URL ?? '/'

/** Resolve a root-relative URL against the deploy base. */
export function resolveAsset(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith(APP_BASE)) return path
  // Trim leading slash(es), join under the base (which ends with '/').
  return `${APP_BASE}${path.replace(/^\/+/, '')}`
}
