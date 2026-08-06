import { defineConfig, type ViteDevServer, type PreviewServer } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { createReadStream, statSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const projectRoot = dirname(fileURLToPath(import.meta.url))
// Monorepo module-assets root: packages/modules/<category>/<module>/assets/.
// Served at /modules/<category>/<module>/assets/... (ADR-025 - a module's
// binary artifacts live with the module, not in a central pool).
const modulesRoot = resolve(projectRoot, '../../packages/modules')

/**
 * Copy each module's assets/ dir into the build output at
 * dist/modules/<category>/<module>/assets/... (Q-K2 / ADR-025), and copy the
 * onnxruntime-web WASM runtime from node_modules into dist/ort/ (P0-4; the
 * wasm is a pinned npm artifact, gitignored, not committed).
 */
function copyModuleAssets(): Plugin {
  return {
    name: 'wake-studio:copy-module-assets',
    apply: 'build',
    closeBundle() {
      const distModules = resolve(projectRoot, 'dist', 'modules')
      if (existsSync(modulesRoot)) {
        const copyTree = (src: string, dest: string) => {
          if (!existsSync(src)) return
          mkdirSync(dest, { recursive: true })
          for (const entry of readdirSafe(src)) {
            const s = join(src, entry)
            const d = join(dest, entry)
            if (isDir(s)) copyTree(s, d)
            else cpSync(s, d)
          }
        }
        // Copy <category>/<module>/assets -> dist/modules/<category>/<module>/assets
        for (const category of readdirSafe(modulesRoot)) {
          const catPath = join(modulesRoot, category)
          if (!isDir(catPath)) continue
          for (const mod of readdirSafe(catPath)) {
            const assetsDir = join(catPath, mod, 'assets')
            if (isDir(assetsDir)) {
              copyTree(assetsDir, join(distModules, category, mod, 'assets'))
            }
          }
        }
      }
      // Copy onnxruntime-web wasm runtime (P0-4 offline): node_modules -> dist/ort/
      const ortDist = join(
        projectRoot,
        '..',
        '..',
        'node_modules',
        '.pnpm',
      )
      const ortWasmDir = findOrtDist(ortDist)
      if (ortWasmDir) {
        const dest = resolve(projectRoot, 'dist', 'ort')
        mkdirSync(dest, { recursive: true })
        for (const f of readdirSafe(ortWasmDir)) {
          if (f.endsWith('.wasm') && f.startsWith('ort-wasm-simd-threaded')) {
            cpSync(join(ortWasmDir, f), join(dest, f))
          }
        }
      }
    },
  }
}

/** Locate the onnxruntime-web dist dir in the pnpm store (first match). */
function findOrtDist(pnpmRoot: string): string | null {
  const versions = readdirSafe(pnpmRoot).filter((v) =>
    v.startsWith('onnxruntime-web@'),
  )
  for (const v of versions) {
    const cand = join(pnpmRoot, v, 'node_modules', 'onnxruntime-web', 'dist')
    if (isDir(cand)) return cand
  }
  return null
}

function readdirSafe(p: string): string[] {
  try {
    return readdirSync(p) as string[]
  } catch {
    return []
  }
}
function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Dev/preview plugin: serve module-owned assets and the onnxruntime wasm.
 *
 *   /modules/<category>/<module>/assets/<rel> -> packages/modules/.../assets
 *   /ort/<rel>                                -> onnxruntime-web dist (node_modules)
 *
 * (ADR-025; the legacy central /prebuilts/ pool was retired.)
 */
function serveAssets() {
  const contentTypes: Record<string, string> = {
    '.onnx': 'application/octet-stream',
    // ONNX external-data weights (e.g. plixkws-small.onnx.data). onnxruntime-web
    // fetches these co-located files by name; a stable binary content-type is
    // required so the streaming fetch resolves the tensor weights.
    '.data': 'application/octet-stream',
    '.tflite': 'application/octet-stream',
    '.wasm': 'application/wasm',
    '.json': 'application/json',
  }

  /**
   * Serve files from a disk root at a URL prefix, with a path-traversal guard.
   *
   * @param urlPrefix  e.g. '/modules/'
   * @param diskRoot   e.g. resolve(projectRoot, '../../packages/modules')
   * @param strip      how much of the URL to strip before resolving (defaults
   *                   to urlPrefix).
   */
  const makeHandler = (
    urlPrefix: string,
    diskRoot: string,
    strip?: string,
  ) => {
    const prefix = strip ?? urlPrefix
    return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const url = req.url ?? ''
      if (!url.startsWith(urlPrefix)) return next()
      const rel = url.split('?')[0].slice(prefix.length)
      const filePath = resolve(diskRoot, rel)
      // Path-traversal guard: must stay under diskRoot.
      if (!filePath.startsWith(diskRoot + '/') && filePath !== diskRoot) {
        return next()
      }
      try {
        const stat = statSync(filePath)
        if (!stat.isFile()) {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        res.setHeader(
          'Content-Type',
          contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        )
        res.setHeader('Content-Length', stat.size)
        createReadStream(filePath).pipe(res)
      } catch {
        // File missing or unreadable - return 404 (don't fall through to the SPA
        // fallback, which would serve index.html and confuse fetch()/onnxruntime).
        res.statusCode = 404
        res.end('Not found')
      }
    }
  }

  // Module-owned assets (ADR-025): /modules/<category>/<module>/assets/<rel>
  // -> packages/modules/<category>/<module>/assets/<rel>. A module declares its
  // artifact URLs in spec/module.spec.json runtime.web.wasm.url.
  const modulesHandler = makeHandler('/modules/', modulesRoot, '/modules/')
  // onnxruntime-web wasm runtime (P0-4): /ort/<rel> -> node_modules dist.
  const ortDist = findOrtDist(resolve(projectRoot, '..', '..', 'node_modules', '.pnpm'))
  const ortHandler = ortDist
    ? makeHandler('/ort/', ortDist)
    : (_req: IncomingMessage, _res: ServerResponse, next: () => void) => next()

  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    modulesHandler(req, res, () => ortHandler(req, res, next))
  }
  return {
    name: 'wake-studio:serve-assets',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(handler)
    },
  }
}

// Deploy base path is configurable (ADR-012): GitHub Pages project sites need a
// sub-path (/<repo>/); Cloudflare Pages serves at root (/).
const base = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig({
  base,
  // Optional, dynamically-imported dependencies. The 'transformers' runtime
  // loads @huggingface/transformers from the jsDelivr CDN at runtime (full URL
  // import in plix-transformers.ts), so it is NOT bundled and does not need to
  // be installed. 'executorch' is a deferred runtime. These are listed as
  // external so any stray static reference is left as a bare specifier rather
  // than failing the build (see ModelRuntime in src/runtime.ts and the
  // per-runtime encoder backends).
  //   - @huggingface/transformers : PLiX 'transformers' runtime (v4 browser build, CDN)
  //   - executorch               : PLiX 'executorch' runtime (WASM, deferred impl)
  build: {
    rollupOptions: {
      external: ['@huggingface/transformers', 'executorch'],
    },
  },
  plugins: [
    react(),
    serveAssets(),
    copyModuleAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'model-registry.json'],
      manifest: {
        name: 'WakeStudio',
        short_name: 'WakeStudio',
        description:
          'Train, visualize, and export on-device wake-word (KWS) pipelines: AEC -> BSS -> NS -> KWS.',
        theme_color: '#0ea5e9',
        background_color: '#0b1020',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm,json}'],
        // The onnxruntime-web WASM files are large (13-27 MB); we load them from
        // a CDN at runtime (ADR-018), so exclude them from the precache.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globIgnores: ['**/ort-wasm-*', '**/sherpa-onnx-kws/**'],
        // Keep the service worker out of the precache so a broken network on
        // first load doesn't deadlock updates.
        navigateFallback: 'index.html',
      },
      // COEP requires that the SW script and everything it fetches are
      // CORP-compliant. We serve the SW same-origin (exempt) and exclude the
      // large cross-origin wasm from precache, so isolation is preserved.
      injectRegister: 'auto',
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
})
