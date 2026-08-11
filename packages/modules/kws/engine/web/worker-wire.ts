/**
 * Worker composition root (ADR-034) - KWS driver registration inside
 * the worker bundle. Imported by web/worker.ts BEFORE any load message.
 *
 * GENERATED FILE - do not edit by hand.
 * Regenerate with: node scripts/gen-module-wires.mjs --update
 *
 * Each driver module registers its backend into the KWS engine registry
 * on import (ADR-024/034). Imported as namespaces and referenced via
 * `void` so Vite cannot tree-shake the side-effect imports (a bare
 * side-effect import is only safe when the package declares
 * `sideEffects: true`; the `void` reference is the defensive form).
 */
import * as openwakewordDriver from '@wake-studio/module-kws-openwakeword'
import * as plixDriver from '@wake-studio/module-kws-plix'
import * as sherpaDriver from '@wake-studio/module-kws-sherpa'
import * as streamingDriver from '@wake-studio/module-kws-streaming'
void openwakewordDriver.OpenWakeWordBackend
void plixDriver.PlixKwsEmbedProvider
void sherpaDriver.SherpaOnnxKwsBackend
void streamingDriver.KWSStreamingBackend
