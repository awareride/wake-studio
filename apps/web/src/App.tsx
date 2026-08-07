/**
 * WakeStudio console app.
 *
 * Phase 1 shell: left sidebar + top bar + hash-routed views, built on Radix
 * primitives. The Workspace hosts the existing live panels (AFE/KWS/Few-Shot)
 * — their internals are refactored in Phase 2.
 */

import * as React from "react";
import { useConsoleRoute, settingsSectionOf, settingsBackendFromHash } from "./router";
import type { SettingsSection } from "./router";
import { ConsoleShell } from "./components/ConsoleShell";
import { ConsoleStatusProvider } from "./status";
import { AppToastProvider } from "./components/toast";
import { ProjectProvider } from "./projects";
import { LogProvider } from "./log";
import { SettingsProvider } from "./settings";
import { WorkspaceView } from "./views/WorkspaceView";
import { ModelLibraryView } from "./views/ModelLibraryView";
import { SessionConsoleView } from "./views/SessionConsoleView";
import { SettingsView } from "./views/SettingsView";
import { ComingSoonView, ProjectsView } from "./views/placeholders";
import { RnnoisePlayground } from "@wake-studio/module-rnnoise/web";

export default function App() {
  const [route, navigate] = useConsoleRoute();
  // Driver anchor for the Modules section (Settings -> driver focus).
  const [settingsBackend, setSettingsBackend] = React.useState<
    string | undefined
  >(() =>
    typeof window === "undefined"
      ? undefined
      : settingsBackendFromHash(window.location.hash),
  );

  React.useEffect(() => {
    const onHash = () =>
      setSettingsBackend(settingsBackendFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <ConsoleStatusProvider>
      <AppToastProvider>
        <ProjectProvider>
          <SettingsProvider>
            <LogProvider>
              <ConsoleShell route={route} onNavigate={navigate}>
                {route === "workspace" && <WorkspaceView />}
                {route === "library" && <ModelLibraryView />}
                {route === "projects" && <ProjectsView />}
                {route === "console" && <SessionConsoleView />}
                {route === "playground-rnnoise" && <RnnoisePlayground />}
                {settingsSectionOf(route) && (
                  <SettingsView
                    section={settingsSectionOf(route) as SettingsSection}
                    backendId={settingsBackend}
                  />
                )}
                {route === "device-sdk" && (
                  <ComingSoonView
                    title="Device SDK"
                    description="Export kits and device-side SDK tooling for your target chips arrive in Phase 4."
                  />
                )}
              </ConsoleShell>
            </LogProvider>
          </SettingsProvider>
        </ProjectProvider>
      </AppToastProvider>
    </ConsoleStatusProvider>
  );
}
