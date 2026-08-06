import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Backend driver registration side-effects (must run once at boot): each
// driver module registers its backend into the KWS engine registry. Imported
// as namespaces and referenced below so Vite cannot tree-shake the side-effect
// (a bare `import '@pkg'` is dropped from the production bundle).
import * as openWakeWordDriver from '@wake-studio/module-kws-openwakeword'
import * as sherpaDriver from '@wake-studio/module-kws-sherpa'
import * as plixDriver from '@wake-studio/module-kws-plix'
import App from './App'
import './index.css'

// Keep the namespace imports live: their modules register backends on import.
void openWakeWordDriver.OpenWakeWordBackend
void sherpaDriver.SherpaOnnxKwsBackend
void plixDriver.PlixKwsBackend

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element #root not found in index.html')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
