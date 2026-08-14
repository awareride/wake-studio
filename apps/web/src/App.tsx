/**
 * WakeStudio console app.
 *
 * Shell: left sidebar + top bar + hash-routed views, built on Radix
 * primitives. The Workspace hosts the live panels. Live pipeline state
 * (LiveAfeProvider / LiveKwsProvider) lives at app level so the top-bar mini
 * pipeline bar can show the running pipeline's status on every view.
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
import { useAppSettings } from "./settings/context";
import { setBrandAccentVars } from "./settings/accent-colors";
import { Theme } from "@radix-ui/themes";
import { WorkspaceView } from "./views/WorkspaceView";
import { ModelLibraryView } from "./views/ModelLibraryView";
import { TrainingView } from "./views/TrainingView";
import { BackendsView } from "./views/BackendsView";
import { SessionConsoleView } from "./views/SessionConsoleView";
import { SettingsView } from "./views/SettingsView";
import { ComingSoonView } from "./views/placeholders";
import { ProjectsView } from "./views/ProjectsView";
import { RnnoisePlayground } from "@wake-studio/module-rnnoise/web";
import { useProjects } from "./projects";
import { LiveAfeProvider, LiveKwsProvider } from "./workspace/live";

export default function App() {
  return (
    <ConsoleStatusProvider>
      <AppToastProvider>
        <ProjectProvider>
          <SettingsProvider>
            <LogProvider>
              <ThemedShell />
            </LogProvider>
          </SettingsProvider>
        </ProjectProvider>
      </AppToastProvider>
    </ConsoleStatusProvider>
  );
}

/**
 * Radix Themes wrapper - accent comes from the saved platform setting
 * (Settings -> General -> Accent color; default gray). Gray is the default;
 * Sky is the classic WakeStudio look. appearance follows the resolved
 * theme mode (Light/Dark/System, Settings or the top-bar switch) so Radix
 * components match the token layer (issue #142).
 */
function ThemedShell() {
  const { platform, resolvedTheme } = useAppSettings();
  const accent = platform['theme.accent'] ?? 'gray';
  // Sync the brand CSS vars (module-kit rendered panels read them) to the
  // selected accent scale (light + dark), alongside the Themes accentColor.
  React.useEffect(() => {
    setBrandAccentVars(accent);
  }, [accent]);
  return (
    <Theme appearance={resolvedTheme} accentColor={accent} grayColor="slate">
      <AppShell />
    </Theme>
  );
}

/** App-level shell: live pipeline state providers + routed views. */
function AppShell() {
  const [route, navigate] = useConsoleRoute();
  const { current } = useProjects();

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

  // AFE stage bypass seeds from the active project's workspace snapshot
  // (providers remount per project so switching projects re-seeds live state).
  const wsCfg = current?.config?.workspace;
  const projectKey = current?.id ?? "none";
  const initialBypass = {
    aec: wsCfg?.enabled?.afeStages?.aec ?? true,
    bss: wsCfg?.enabled?.afeStages?.bss ?? true,
    ns: wsCfg?.enabled?.afeStages?.ns ?? false,
  };

  return (
    <LiveAfeProvider key={`afe-live-${projectKey}`} initialBypass={initialBypass}>
      <LiveKwsProvider key={`kws-live-${projectKey}`}>
        <ConsoleShell route={route} onNavigate={navigate}>
          {/* The workspace stays mounted across route changes (hidden when not
              active) so a running pipeline keeps running while the user
              browses other menus. */}
          <div className={route === "workspace" ? "contents" : "hidden"}>
            <WorkspaceView />
          </div>
          {route === "library" && <ModelLibraryView />}
          {route === "training" && <TrainingView />}
          {route === "backends" && <BackendsView />}
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
      </LiveKwsProvider>
    </LiveAfeProvider>
  );
}
