import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Deploy base path is configurable (ADR-012): GitHub Pages project sites need a
// sub-path (/<repo>/); Cloudflare Pages serves at root (/).
const base = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
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
