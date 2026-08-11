import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Host composition root (ADR-034): the ONLY file in apps/ that imports
// driver (impl) modules. Each driver registers its backend into the KWS
// engine registry on import. Adding a driver regenerates module-wire.ts
// (node scripts/gen-module-wires.mjs --update) - main.tsx never changes.
import './module-wire'
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
