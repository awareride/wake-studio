/**
 * Training view (issue #97 - 'Import Colab results' flow).
 *
 * Hosts the training module's spec-driven panel (ADR-025 - params + train /
 * export actions) plus the Colab import section: pick the zip the module-owned
 * notebook produced, validate against the manifest, and register the model
 * for in-browser test + export. Client-side only (ADR-013/023/035).
 */

import { TrainingModulePanel } from '@wake-studio/module-training/web'
import { buildColabUrl } from '@wake-studio/module-kit'
import { ImportColabResults } from '../training/ImportColabResults'

/** The kws-openwakeword module-owned notebook (ADR-035) this view trains with. */
const OPENWAKEWORD_NOTEBOOK =
  'packages/modules/kws/openwakeword/train/colab/train.ipynb'
/**
 * The notebook's Step 0 params cell id (set in train.ipynb). Deep-linking
 * with #scrollTo lands the user directly on the editable params — Colab
 * cannot be embedded (X-Frame-Options: SAMEORIGIN), so this is the closest
 * "in-panel" experience we can offer.
 */
const OPENWAKEWORD_STEP0_CELL = 'params'

export function TrainingView() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-ink-1">Training</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Train a custom wake word with this platform's Colab notebook
          (free GPU, your Google account — no WakeStudio server). Run the
          notebook, download <code className="font-mono">wake-studio-results.zip</code>,
          then import it here to test and export.
        </p>
        <a
          href={`${buildColabUrl(OPENWAKEWORD_NOTEBOOK)}#scrollTo=${OPENWAKEWORD_STEP0_CELL}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-sm text-brand-400 underline hover:text-brand-300"
        >
          Open the openWakeWord Colab notebook →
        </a>
      </div>

      {/* The module-owned panel: params + train / export actions, generated
          from the training module spec (ADR-025). */}
      <TrainingModulePanel />

      {/* The import half of the loop (issue #97). */}
      <ImportColabResults />
    </div>
  )
}

export default TrainingView