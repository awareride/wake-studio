/**
 * Dataset module - materializers: canonical dataset → per-trainer shape (#206).
 *
 * Different trainers consume data differently (kws-streaming: raw
 * `label/*.wav` tree; openwakeword: precomputed mel features + a positives
 * wav dir + background dirs). One canonical spec + PER-TRAINER materializer —
 * the data-side twin of `standardize-results` (ADR-031): the manifest only
 * declares each label's semantic role (`positive` / `unknown` / `noise`);
 * the materializer creates the folders / features the upstream trainer
 * expects. Roles are the portable vocabulary; folders are per-trainer
 * (docs/modules/data-sources.md §4.2 / §6).
 *
 * This module is the TypeScript SOURCE OF TRUTH for:
 *
 *   1. `TrainerDatasetRequirements` usage — the `spec.train.dataset` contract
 *      (the type itself lives in `@wake-studio/contracts`, beside `ModuleTrain`).
 *   2. The per-trainer role → folder maps (what each materializer produces).
 *   3. `validateDatasetRequirements` — the pre-train validation the wizard
 *      picker runs so the user sees clear warnings instead of a cryptic
 *      trainer crash.
 *
 * The actual disk-writing materialization runs in the training backend —
 * `wake_train_kit/materialize.py` mirrors these rules (same layout as the
 * `spec.ts` ↔ `dataset.py` mirror, ADR-044).
 */

import type { TrainerDatasetRequirements, LabelMode } from '@wake-studio/contracts'
import {
  type DatasetManifest,
  type DatasetLabel,
  type LabelRole,
  CANONICAL_SAMPLE_RATE,
} from './spec'

/** The trainers the dataset layer knows how to materialize for. */
export type MaterializerId = 'kws-streaming' | 'openwakeword'

export const MATERIALIZER_IDS: readonly MaterializerId[] = [
  'kws-streaming',
  'openwakeword',
]

/**
 * What a role maps to in a trainer's on-disk shape. A folder convention is a
 * literal folder name; `wanted-folder` means "the label folder is a wake-word
 * candidate"; `feature-file` means the clips are extracted to a `.npy`.
 */
export type RoleMapping =
  | { kind: 'folder'; name: string }
  | { kind: 'wanted-folder' }
  | { kind: 'feature-file'; note: string }

/** One materializer descriptor (the per-trainer shape contract, §6 table). */
export interface MaterializerDescriptor {
  id: MaterializerId
  /** Human-readable summary of the shape this trainer consumes. */
  produces: string
  /** Semantic role → the on-disk shape the materializer writes. */
  roleMap: Record<LabelRole, RoleMapping>
}

/** kws-streaming: near-identity label tree. Positives are the wanted words;
 *  unknowns fold into `_unknown_` upstream; noise becomes `_background_noise_`. */
export const KWS_STREAMING_MATERIALIZER: MaterializerDescriptor = {
  id: 'kws-streaming',
  produces:
    'a `label/*.wav` tree: positive labels are the wake words, unknown labels fold into `_unknown_`, noise becomes `_background_noise_`',
  roleMap: {
    positive: { kind: 'wanted-folder' },
    unknown: { kind: 'folder', name: '<label>' }, // upstream folds non-wanted folders into _unknown_
    noise: { kind: 'folder', name: '_background_noise_' },
  },
}

/** openwakeword: precomputed features + a positives wav dir + background dirs.
 *  Positive clips are copied to a `positives/` wav dir and their mel features
 *  are precomputed; unknown clips are extracted to `.npy` feature files
 *  (feature_data_files); noise clips become background paths. */
export const OPENWAKEWORD_MATERIALIZER: MaterializerDescriptor = {
  id: 'openwakeword',
  produces:
    'a positives wav dir + precomputed mel `.npy` features (unknowns) + background dirs (noise), wired into the upstream custom_model.yml',
  roleMap: {
    positive: { kind: 'folder', name: 'positives/' }, // + feature extractor → .npy
    unknown: { kind: 'feature-file', note: 'precomputed features .npy (feature_data_files)' },
    noise: { kind: 'folder', name: 'background/' }, // → background_paths
  },
}

export const MATERIALIZERS: readonly MaterializerDescriptor[] = [
  KWS_STREAMING_MATERIALIZER,
  OPENWAKEWORD_MATERIALIZER,
]

/** Look up a materializer descriptor by trainer id. */
export function materializerFor(trainerId: string): MaterializerDescriptor | undefined {
  return MATERIALIZERS.find((m) => m.id === trainerId)
}

/** The trainer folder convention a label role maps to (folder names, §6). */
export function roleFolderName(
  trainerId: string,
  role: LabelRole,
  label?: DatasetLabel,
): string | null {
  const materializer = materializerFor(trainerId)
  if (!materializer) return null
  const mapping = materializer.roleMap[role]
  if (mapping.kind === 'feature-file') return null
  if (mapping.kind === 'wanted-folder') return label?.name ?? null
  if (mapping.name === '<label>') return label?.name ?? null
  return mapping.name
}

// ---------------------------------------------------------------------------
// Pre-train requirements validation (the wizard picker + the backend mirror)
// ---------------------------------------------------------------------------

/** One dataset the validation inspects (manifest + optional exact clip counts). */
export interface DatasetValidationInput {
  manifest: DatasetManifest
  /** Exact per-label clip counts (from the importer's ClipTree) when available;
   *  without it min-clips checks fall back to the manifest's total `audio.clips`. */
  clipsPerLabel?: Record<string, number>
}

export interface DatasetRequirementsValidation {
  /** False when there is at least one blocking error (trainer would crash /
   *  produce a useless model). The wizard blocks starting with a clear message. */
  ok: boolean
  /** Blocking problems (missing required roles, no wake word, wrong rate...). */
  errors: string[]
  /** Non-blocking warnings (thin labels, non-commercial provenance...). */
  warnings: string[]
}

function labelRole(labels: DatasetLabel[] | undefined, role: LabelRole): DatasetLabel[] {
  return (labels ?? []).filter((l) => l.role === role)
}

function isSingle(datasets: DatasetValidationInput[]): boolean {
  return datasets.length === 1
}

/** Combined pre-train validation of the picked datasets against requirements. */
export function validateDatasetRequirements(
  datasets: DatasetValidationInput[],
  requirements: TrainerDatasetRequirements | undefined,
): DatasetRequirementsValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!datasets.length) {
    return { ok: false, errors: ['Pick at least one dataset.'], warnings }
  }

  const req = requirements ?? {}
  const positives: DatasetLabel[] = []
  const unknowns: DatasetLabel[] = []
  const noises: DatasetLabel[] = []
  let allRateOk = true
  let allCommercial = true

  for (const { manifest, clipsPerLabel } of datasets) {
    positives.push(...labelRole(manifest.labels, 'positive'))
    unknowns.push(...labelRole(manifest.labels, 'unknown'))
    noises.push(...labelRole(manifest.labels, 'noise'))

    const rate = manifest.audio?.sampleRate
    if (req.sampleRate && rate && rate !== req.sampleRate) {
      errors.push(
        `"${manifest.name}" is ${rate} Hz but this trainer needs ${req.sampleRate} Hz ` +
          `(the canonical dataset form is ${CANONICAL_SAMPLE_RATE} Hz; resample before use).`,
      )
      allRateOk = false
    }

    // Per-label minimum for the positive (wake-word) labels.
    if (req.minClipsPerLabel) {
      for (const positive of labelRole(manifest.labels, 'positive')) {
        const exact = clipsPerLabel?.[positive.name]
        const count = exact ?? Math.floor((manifest.audio?.clips ?? 0) / Math.max(1, manifest.labels.length))
        if (count < req.minClipsPerLabel) {
          warnings.push(
            `"${manifest.name}" label "${positive.name}" has ~${count} clips ` +
              `(this trainer wants ≥ ${req.minClipsPerLabel} per wake word; thin labels underfit).`,
          )
        }
      }
    }

    if (manifest.provenance?.some((p) => p.commercialUse === false)) {
      allCommercial = false
    }
  }

  // labelMode
  const labelMode: LabelMode | undefined = req.labelMode
  if (labelMode === 'single' && positives.length !== 1) {
    errors.push(
      `This trainer is single-word (labelMode: single) but the picked datasets ` +
        `declare ${positives.length} positive label(s) — pick datasets with exactly one wake word.`,
    )
  } else if (labelMode === 'multi' && positives.length < 1) {
    errors.push('No positive (wake-word) label found in the picked datasets.')
  }
  if (!labelMode && positives.length < 1) {
    errors.push('No positive (wake-word) label found in the picked datasets.')
  }

  // required roles (combined view — dataset A positives + dataset B noise is fine)
  if (req.needsNoise && noises.length === 0) {
    errors.push(
      'This trainer needs background noise (`role: noise`) but none of the picked ' +
        'datasets declares a noise label — add one (it becomes `_background_noise_` / the background paths).',
    )
  }
  if (req.needsUnknowns && unknowns.length === 0) {
    errors.push(
      'This trainer needs an `_unknown_` / negatives class (`role: unknown`) but none of ' +
        'the picked datasets declares one — the model cannot reject non-wake audio.',
    )
  }

  if (!allCommercial) {
    warnings.push(
      'One or more picked datasets is NOT commercially usable (provenance.commercialUse = false) — ' +
        'the trained model inherits the restriction (the export gate will block commercial bundles, #210).',
    )
  }

  // A single tiny dataset with no unknown/noise is very likely a mistake.
  if (
    isSingle(datasets) &&
    req.needsNoise &&
    req.needsUnknowns &&
    positives.length > 0 &&
    unknowns.length === 0 &&
    noises.length === 0
  ) {
    warnings.push(
      'You picked one wake-word-only dataset; training usually also wants an `unknowns` and a `noise` ' +
        'dataset (mix them in the picker — the materializer merges roles, #158).',
    )
  }

  void allRateOk
  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Plan the on-disk layout for a kws-streaming materialization from the merged
 * manifests — the pure, browser-testable view of what
 * `wake_train_kit.materialize.materialize_kws_streaming` writes.
 */
export function planKwsStreamingLayout(
  datasets: DatasetValidationInput[],
): {
  wantedWords: string[]
  unknownLabels: string[]
  noiseFolder: boolean
} {
  const wantedWords = new Set<string>()
  const unknownLabels = new Set<string>()
  let noiseFolder = false
  for (const { manifest } of datasets) {
    for (const label of manifest.labels ?? []) {
      if (label.role === 'positive') wantedWords.add(label.name)
      else if (label.role === 'unknown') unknownLabels.add(label.name)
      else if (label.role === 'noise') noiseFolder = true
    }
  }
  return {
    wantedWords: [...wantedWords],
    unknownLabels: [...unknownLabels],
    noiseFolder,
  }
}
