/**
 * Datasets — browser generation executor (ADR-044 §8.1, #208).
 *
 * Runs the SAME one pipeline as the backend (`wake_train_kit/generation.py`)
 * entirely client-side: collect -> synthesize (online HTTP TTS) ->
 * postprocess (passthrough — audio-quality transforms stay backend for now) ->
 * assemble (canonical tree + manifest + contentHash) -> zip (fflate). The
 * produced `wake-studio-dataset.zip` is saved to the browser-local store
 * (and optionally pushed to the user's cloud).
 *
 * Browser-only by design: fetch TTS + Web Audio resample + fflate zip.
 * Pure helpers (manifest build, WAV container, zip assembly) live in the
 * L1-tested `@wake-studio/module-dataset` core.
 */

import {
  buildGeneratedManifest,
  assembleDatasetZip,
  sanitizeLabel,
  writeSilenceWav,
  type ClipTree,
  type DatasetManifest,
  type GenerationParams,
} from '@wake-studio/module-dataset'
import { CANONICAL_SAMPLE_RATE } from '@wake-studio/module-dataset'
import { fetchTtsClip, BrowserTtsError, type HttpTtsParams } from './http-tts'
import { toCanonicalWav } from './audio'

export interface BrowserGenerationProgress {
  stage: 'synthesize' | 'assemble' | 'done'
  /** Clips synthesized so far. */
  done: number
  /** Total clips to synthesize. */
  total: number
  message: string
}

export type BrowserGenerationParams = GenerationParams & HttpTtsParams

/** Browser-run generation -> the canonical zip + manifest + clip tree. */
export async function generateDatasetInBrowser(
  params: BrowserGenerationParams,
  onProgress?: (p: BrowserGenerationProgress) => void,
): Promise<{ manifest: DatasetManifest; zipBytes: Uint8Array; clips: ClipTree }> {
  const phrases = (params.phrases ?? []).filter(Boolean)
  if (!phrases.length) {
    throw new BrowserTtsError('Generation needs at least one wake phrase.')
  }
  const languages = params.languages?.length ? params.languages : ['en-US']
  const samples = Math.max(1, Number(params.samplesPerPhrase) || 3)
  const sampleRate = Number(params.sampleRate) || CANONICAL_SAMPLE_RATE

  // synthesize: one clip per (phrase x sample), as canonical 16 kHz mono WAV.
  const clips: ClipTree = {}
  let total = phrases.length * samples
  let done = 0
  const report = (stage: BrowserGenerationProgress['stage'], message: string) =>
    onProgress?.({ stage, done, total, message })

  report('synthesize', `synthesizing ${phrases.length} phrase(s) × ${samples} clips`)
  for (const phrase of phrases) {
    const label = sanitizeLabel(phrase)
    clips[label] = []
    for (let i = 0; i < samples; i++) {
      const audio = await fetchTtsClip(params, phrase)
      const wav = await toCanonicalWav(audio, sampleRate)
      clips[label].push({ name: `${languages[0]}_${i}.wav`, bytes: wav })
      done += 1
      report('synthesize', `“${phrase}” clip ${i + 1}/${samples}`)
    }
  }

  // Silence clips keep augmentation happy (mirrors the backend layout).
  clips['_background_noise_'] = []
  for (let i = 0; i < 3; i++) {
    clips['_background_noise_'].push({
      name: `silence_${i}.wav`,
      bytes: writeSilenceWav(1.0, CANONICAL_SAMPLE_RATE),
    })
  }
  total += 3

  // assemble: labels + manifest + contentHash + zip.
  const labels: Array<{ name: string; role: 'positive' | 'noise'; language?: string; source: 'synthetic' }> =
    phrases.map((phrase) => ({
      name: sanitizeLabel(phrase),
      role: 'positive' as const,
      language: languages[0],
      source: 'synthetic' as const,
    }))
  labels.push({ name: '_background_noise_', role: 'noise' as const, source: 'synthetic' as const })

  report('assemble', 'assembling the canonical wake-studio-dataset.zip')
  const manifest = buildGeneratedManifest(params, labels, total, Date.now())
  const { manifest: final, zipBytes } = await assembleDatasetZip(manifest, clips)
  report('done', 'dataset generated in the browser')
  return { manifest: final, zipBytes, clips }
}
