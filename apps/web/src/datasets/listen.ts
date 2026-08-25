/**
 * Datasets — review & listen (ADR-045 §8.3, #220).
 *
 * The per-clip audio player is shown only where reading a single clip is cheap
 * (**listenable** — the §8.3 table):
 *
 *   | Form        | Location       | Listen? |
 *   |-------------|----------------|---------|
 *   | directory   | local OPFS     | ✓       |
 *   | directory   | cloud (HF)     | ✓ (fetch one wav) |
 *   | zip         | local OPFS     | ✓ (single-entry extract) |
 *   | zip         | remote blob    | ✗       |
 *
 * Implemented today: local (OPFS) datasets — via single-entry zip reads. Cloud
 * directories become listensable once dir-form cloud push lands (follow-up).
 */

import type { ConsoleDataset } from './store'
import {
  listDatasetClips as listOpfsClips,
  readDatasetClipBytes as readOpfsClip,
  type DatasetClipRef,
} from './browser/opfs-dataset'

export type { DatasetClipRef } from './browser/opfs-dataset'

/** §8.3 gate: true only where the in-app player can read one clip cheaply. */
export function datasetIsListenable(dataset: ConsoleDataset): boolean {
  return dataset.origin === 'local'
}

/** The clips of a listensable dataset, in `audio/<label>/` tree order. */
export async function listListenableClips(dataset: ConsoleDataset): Promise<DatasetClipRef[]> {
  if (!datasetIsListenable(dataset)) return []
  return listOpfsClips(dataset.id)
}

/** One clip's canonical WAV bytes (bounded to that single clip). */
export async function readListenableClipBytes(
  dataset: ConsoleDataset,
  path: string,
): Promise<Uint8Array> {
  if (!datasetIsListenable(dataset)) {
    throw new Error('This dataset form is not listensable (see §8.3).')
  }
  return readOpfsClip(dataset.id, path)
}