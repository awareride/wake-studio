import { defineConfig, type ViteDevServer, type PreviewServer } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { createReadStream, statSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

const projectRoot = dirname(fileURLToPath(import.meta.url))
const prebuiltsRoot = resolve(projectRoot, 'prebuilts')

/**
 * Dev/preview plugin: serve the local `prebuilts/` directory at `/prebuilts/`
 * (ADR-011 amendment - pre-fetched local assets). These are dev-only; they are
 * gitignored and never bundled into the PWA build (dist/). In a deployed build
 * the registry falls back to remote URLs.
 */
function servePrebuilts() {
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
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? ''
    if (!url.startsWith('/prebuilts/')) return next()
    // Strip query and the leading "/prebuilts/".
    const rel = url.split('?')[0].slice('/prebuilts/'.length)
    const filePath = resolve(prebuiltsRoot, rel)
    // Path-traversal guard: must stay under prebuilts/.
    if (!filePath.startsWith(prebuiltsRoot + '/') && filePath !== prebuiltsRoot) {
      return next()
    }
    try {
      const stat = statSync(filePath)
      if (!stat.isFile()) {
        res.statusCode = 404
        res.end('Not found')
        return
      }
      res.setHeader('Content-Type', contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream')
      res.setHeader('Content-Length', stat.size)
      createReadStream(filePath).pipe(res)
    } catch {
      // File missing or unreadable - return 404 (don't fall through to the SPA
      // fallback, which would serve index.html and confuse fetch()/onnxruntime).
      res.statusCode = 404
      res.end('Not found')
    }
  }
  return {
    name: 'wake-studio:serve-prebuilts',
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
    servePrebuilts(),
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
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
  },
})
