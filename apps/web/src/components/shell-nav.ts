/**
 * Sidebar navigation model (shell).
 *
 * Kept separate from the shell components so `react-refresh` doesn't warn
 * about non-component exports in a component file.
 */

import type { ConsoleRoute } from '../router'
import {
  IconWorkspace,
  IconLibrary,
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
}

export const PRIMARY_NAV: NavItem[] = [
  { route: 'workspace', label: 'Workspace', icon: IconWorkspace },
  { route: 'library', label: 'Model Library', icon: IconLibrary },
  { route: 'projects', label: 'Projects', icon: IconFolder },
  { route: 'console', label: 'Console', icon: IconConsole },
]

export const SECONDARY_NAV: NavItem[] = [
  { route: 'device-sdk', label: 'Device SDK', icon: IconChip, badge: 'soon' },
  { route: 'settings', label: 'Settings', icon: IconSettings },
]
