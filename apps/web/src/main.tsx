import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Radix Themes - component + theming layer (colors from Radix Colors).
// Imported before index.css so the app's token overrides (scrollbar, body)
// win the cascade.
import '@radix-ui/themes/styles.css'
import { Theme } from '@radix-ui/themes'
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
    <Theme appearance="light" accentColor="sky" grayColor="slate">
      <App />
    </Theme>
  </StrictMode>,
)
