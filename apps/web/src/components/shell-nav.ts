/**
 * Sidebar navigation model (shell).
 *
 * Kept separate from the shell components so `react-refresh` doesn't warn
 * about non-component exports in a component file.
 */

import type { ConsoleRoute, SettingsSection } from '../router'
import { settingsRoute } from '../router'
import {
  IconWorkspace,
  IconLibrary,
  IconTrain,
  IconFolder,
  IconSettings,
  IconChip,
  IconConsole,
} from './icons'

export interface NavItem {
  route: ConsoleRoute
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  badge?: string
  /** Child sub-menu items (expanded in the sidebar, e.g. Settings sections). */
  children?: SettingsNavItem[]
}

export interface SettingsNavItem {
  /** Settings sub-route (settings-general etc). */
  route: ConsoleRoute
  label: string
}

export const PRIMARY_NAV: NavItem[] = [
  { route: 'workspace', label: 'Workspace', icon: IconWorkspace },
  { route: 'library', label: 'Model Registry', icon: IconLibrary },
  { route: 'training', label: 'Training', icon: IconTrain },
  { route: 'projects', label: 'Projects', icon: IconFolder },
  { route: 'console', label: 'Console', icon: IconConsole },
]

/** Settings sections shown as the Settings sub-menu. */
export const SETTINGS_NAV: SettingsNavItem[] = [
  { route: settingsRoute('general'), label: 'General' },
  { route: settingsRoute('security'), label: 'Security' },
  { route: settingsRoute('data'), label: 'Data' },
]

export const SECONDARY_NAV: NavItem[] = [
  { route: 'device-sdk', label: 'Device SDK', icon: IconChip, badge: 'soon' },
  {
    route: 'settings',
    label: 'Settings',
    icon: IconSettings,
    children: SETTINGS_NAV,
  },
]

/** True when a route is one of the settings sub-routes. */
export function isSettingsRoute(route: ConsoleRoute): boolean {
  return route.startsWith('settings')
}

export type { SettingsSection }
