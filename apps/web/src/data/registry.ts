/**
 * Model registry + probe - re-export from @wake-studio/platform.
 *
 * The implementation moved to the platform package (module-migration §6.1);
 * apps/web re-exports for compatibility during the migration. New imports
 * should come from `@wake-studio/platform` directly.
 */

export {
  loadRegistry,
  isCommerciallyUsable,
  type ModelRegistry,
  type RegistryModel,
  type ModelTier,
  type ModelClass,
} from '@wake-studio/platform'
export { probeModelUrl, type ProbeResult } from '@wake-studio/platform'
