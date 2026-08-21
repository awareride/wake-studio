/**
 * Dataset module — browser-side generation helpers (ADR-044 §5, #208).
 *
 * The BROWSER executor runs the same one pipeline as the backend
 * (`wake_train_kit/generation.py`): collect -> synthesize -> postprocess ->
 * assemble -> persist — but client-side (online HTTP TTS engines only, no
 * studio-backend). The Web-Audio decode/resample step is browser-only and
 * lives in the web app; EVERYTHING here is pure + L1-testable (vitest), so
 * the manifest build, canonical layout and zip assembly are verified in CI
 * and stay byte-compatible with the backend (same `contentHash` rules,
 * `core/hash.ts`).
 */

import { zipSync, strToU8 } from 'fflate'
import { datasetContentHash, type ClipTree } from './hash'
import {
  CANONICAL_SAMPLE_RATE,
  CANONICAL_ENCODING,
  type DatasetManifest,
  type DatasetLabel,
} from './spec'

/** The wizard-level generation inputs (shared by both executors). */
export interface GenerationParams {
  /** TTS engine id (dataset-engines.json), e.g. "mimo-tts". */
  engine: string
  /** One or more wake phrases (each becomes a `positive` label). */
  phrases: string[]
  /** BCP-47 language tags (e.g. ["en-US", "zh-CN"]). */
  languages?: string[]
  /** Clips to synthesize per phrase. */
  samplesPerPhrase?: number
  /** Optional dataset name (defaults to `phrase-languages`). */
  name?: string
  /** Optional stable dataset id (defaults to a uuid). */
  datasetId?: string
  /** Postprocess transform id (passthrough | openwakeword-style). */
  postprocess?: string
  /** Engine-specific params (endpoint/apiKey/model/voice/...). */
  [key: string]: unknown
}

/** A raw synthesized clip (audio bytes + the WAV filename). */
export interface GeneratedClip {
  label: string
  name: string
  /** Canonical 16 kHz mono PCM WAV bytes. */
  wav: Uint8Array
}

/** Sanitize a phrase into a canonical label folder name (matches the
 *  backend `sanitize_label` / `_sanitize_label`). */
export function sanitizeLabel(text: string): string {
  const cleaned = text.trim().toLowerCase().replace(/[^0-9a-zA-Z_-]+/g, '_')
  return cleaned || 'word'
}

/** Wrap raw 16-bit PCM samples in a canonical WAV container (pure). */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const bytesPerSample = 2
  const byteRate = sampleRate * channels * bytesPerSample
  const blockAlign = channels * bytesPerSample
  const dataSize = pcm.byteLength
  const header = new ArrayBuffer(44)
  const view = new DataView(header)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)

  const out = new Uint8Array(44 + dataSize)
  out.set(new Uint8Array(header), 0)
  out.set(pcm, 44)
  return out
}

/** True when bytes look like a RIFF/WAVE file (vs headerless PCM). */
export function isWavBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x41 && // A
    bytes[10] === 0x56 && // V
    bytes[11] === 0x45 // E
  )
}

/** A deterministic 1 s silence clip (keeps augmentation happy, mirrors the
 *  backend `write_silence_wav`). */
export function writeSilenceWav(seconds = 1.0, sampleRate = CANONICAL_SAMPLE_RATE): Uint8Array {
  const samples = Math.round(seconds * sampleRate)
  const pcm = new Uint8Array(samples * 2)
  return pcmToWav(pcm, sampleRate, 1)
}

/** Build the `dataset.json` manifest for a generated dataset (mirrors the
 *  backend `build_manifest` so both executors produce identical artifacts). */
export function buildGeneratedManifest(
  params: GenerationParams,
  labels: DatasetLabel[],
  clips: number,
  createdAtMs: number,
): DatasetManifest {
  const phrases = params.phrases ?? []
  const languages = params.languages?.length ? params.languages : ['en-US']
  const name =
    params.name?.trim() ||
    (phrases.length
      ? `${sanitizeLabel(phrases[0])}-${languages.join('-')}`
      : 'generated-dataset')
  const datasetId = params.datasetId?.trim() || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return {
    schemaVersion: 1,
    id: datasetId,
    name,
    version: 1,
    kind: 'generated',
    role: 'mixed',
    audio: {
      sampleRate: CANONICAL_SAMPLE_RATE,
      channels: 1,
      encoding: CANONICAL_ENCODING,
      clips,
      durationSec: 0,
    },
    labels,
    provenance: [
      {
        name: 'browser-generated synthetic speech (online TTS API)',
        license: 'user-owned (synthetic TTS)',
        commercialUse: true,
      },
    ],
    recipe: {
      engine: params.engine,
      phrases,
      languages,
      seed: 0,
      toolVersions: {},
    },
    storage: { backend: '' },
    createdAtMs,
  }
}

/** Assemble the canonical `wake-studio-dataset.zip` (dataset.json + audio/
 *  tree) from a manifest + clip tree. The contentHash is computed and
 *  embedded BEFORE zipping (like the backend). */
export async function assembleDatasetZip(
  manifest: DatasetManifest,
  clips: ClipTree,
): Promise<{ manifest: DatasetManifest; zipBytes: Uint8Array }> {
  const contentHash = await datasetContentHash(manifest, clips)
  const finalManifest = { ...manifest, contentHash }
  const entries: Record<string, Uint8Array> = {
    'dataset.json': strToU8(JSON.stringify(finalManifest, null, 2)),
  }
  for (const label of Object.keys(clips).sort()) {
    for (const clip of clips[label]) {
      entries[`audio/${label}/${clip.name}`] = clip.bytes
    }
  }
  return { manifest: finalManifest, zipBytes: zipSync(entries) }
}
