/**
 * Model reachability probe - re-export from @wake-studio/platform.
 *
 * Implementation moved to the platform package (§6.1); kept as a re-export
 * during the migration. New imports should come from `@wake-studio/platform`.
 */

export { probeModelUrl, type ProbeResult } from '@wake-studio/platform'
