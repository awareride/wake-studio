/**
 * RNNoise module spec (typed).
 *
 * Single shared fact source (ADR-025) - the web panel generator, the
 * local-service registry, and CI all consume this one spec object.
 */

import raw from './module.spec.json'
import type { ModuleSpec } from '@wake-studio/contracts'

export const RNNOISE_SPEC = raw as unknown as ModuleSpec
