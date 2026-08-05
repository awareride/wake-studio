/**
 * Global model-runtime abstraction - re-export from @wake-studio/platform.
 *
 * The implementation moved to the platform package (§6.3a). Kept as a
 * re-export for the few-shot panel until §6.4; new imports should come from
 * `@wake-studio/platform` directly.
 */

export {
  DEFAULT_MODEL_RUNTIME,
  RUNTIME_LABELS,
  type ModelRuntime,
} from '@wake-studio/platform'
