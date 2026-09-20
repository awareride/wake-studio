/**
 * `/modules/<category>/<module>/assets/...` -> R2 `modules/...` (ADR-046).
 *
 * In `VITE_ASSETS_MODE=external` builds these files are not in `dist/`; the
 * `RUNTIME_ASSETS` R2 binding (apps/web/wrangler.toml) serves them same-origin so the
 * Cloudflare Pages 25 MiB/file limit does not apply. `_routes.json` (emitted
 * by the build) sends only `/modules/*` and `/ort/*` here; all other requests
 * are served as static assets without invoking a Function.
 */

import { serveAsset } from '../_lib/r2-assets'
import type { CatchAllPagesContext } from '../_lib/r2-types'

export const onRequest = (context: CatchAllPagesContext): Promise<Response> =>
  serveAsset(context.request, context.env, 'modules', context.params.path)
