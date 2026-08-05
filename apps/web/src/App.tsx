/**
 * WakeStudio console app.
 *
 * Phase 1 shell: left sidebar + top bar + hash-routed views, built on Radix
 * primitives. The Workspace hosts the existing live panels (AFE/KWS/Few-Shot)
 * — their internals are refactored in Phase 2.
 */

import { useConsoleRoute } from './router'
import { ConsoleShell } from './components/ConsoleShell'
import { ConsoleStatusProvider } from './status'
import { AppToastProvider } from './components/toast'
import { ProjectProvider } from './projects'
import { LogProvider } from './log'
import { WorkspaceView } from './views/WorkspaceView'
import { ModelLibraryView } from './views/ModelLibraryView'
import { SessionConsoleView } from './views/SessionConsoleView'
import { ComingSoonView, ProjectsView } from './views/placeholders'
import { RnnoisePlayground } from '@wake-studio/module-rnnoise/web'

export default function App() {
  const [route, navigate] = useConsoleRoute()

  return (
    <ConsoleStatusProvider>
      <AppToastProvider>
        <ProjectProvider>
          <LogProvider>
            <ConsoleShell route={route} onNavigate={navigate}>
              {route === 'workspace' && <WorkspaceView />}
              {route === 'library' && <ModelLibraryView />}
              {route === 'projects' && <ProjectsView />}
              {route === 'console' && <SessionConsoleView />}
              {route === 'playground-rnnoise' && <RnnoisePlayground />}
              {route === 'settings' && (
                <ComingSoonView
                  title="Settings"
                  description="Console preferences, model source configuration and export defaults will live here."
                />
              )}
              {route === 'device-sdk' && (
                <ComingSoonView
                  title="Device SDK"
                  description="Export kits and device-side SDK tooling for your target chips arrive in Phase 4."
                />
              )}
            </ConsoleShell>
          </LogProvider>
        </ProjectProvider>
      </AppToastProvider>
    </ConsoleStatusProvider>
  )
}
