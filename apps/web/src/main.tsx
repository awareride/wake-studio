import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Backend driver registration side-effects (must run once at boot): each
// driver module registers its backend into the KWS engine registry.
import '@wake-studio/module-kws-openwakeword'
import '@wake-studio/module-kws-sherpa'
import '@wake-studio/module-kws-plix'
import App from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element #root not found in index.html')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
