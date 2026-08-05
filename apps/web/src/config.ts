/**
 * App base-path config (ADR-012) - re-export from @wake-studio/platform.
 *
 * The implementation moved to the platform package (module-migration §6.1);
 * apps/web re-exports for compatibility during the migration. New imports
 * should come from `@wake-studio/platform` directly.
 */

export { APP_BASE, resolveAsset } from '@wake-studio/platform'
