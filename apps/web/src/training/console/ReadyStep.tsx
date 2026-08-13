/**
 * Training wizard — Step 4: Ready to confirm (issue #105).
 *
 * Reviews the train (module + params + method) and shows the train input
 * file for review — for Colab the .ipynb notebook with a Review button
 * (full NotebookTs dialog). The Save/Start button lives in the wizard
 * footer, in the same position as Next.
 */

import { type TrainMethodId } from '@wake-studio/module-training'
import type { TrainableModule } from '../train-modules'
import { FileReviewCard } from './FileReviewCard'
import { trainInputFile } from './train-files'

export interface ReadyStepProps {
  module: TrainableModule
  method: TrainMethodId
  params: Record<string, string>
  /** Open the full notebook review panel (issue #105). */
  onReview: () => void
}

function methodLabel(method: TrainMethodId): string {
  return method === 'colab' ? 'Google Colab' : method === 'subprocess' ? 'Self-hosted service' : 'CI'
}

export function ReadyStep({ module, method, params, onReview }: ReadyStepProps) {
  const file = trainInputFile(module, method)
  const labels = new Map((module.train.params ?? []).map((p) => [p.id, p.label]))
  const paramRows = Object.entries(params)

  return (
    <div className="space-y-4">
      {/* Train summary. */}
      <div className="rounded-xl border border-line bg-surface-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink-1">Ready to confirm</h3>
          <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
            {module.id}
          </span>
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success">
            {methodLabel(method)}
          </span>
        </div>

        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          {paramRows.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3">
              <dt className="text-ink-3">{labels.get(key) ?? key}</dt>
              <dd className="truncate font-mono text-ink-1" title={value}>
                {value || '—'}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Inputs review: the file that actually trains (Review opens the full
          notebook dialog; the panel itself stays compact, issue #105). */}
      {file && (
        <FileReviewCard
          title={file.title}
          fileName={file.fileName}
          kind={file.kind}
          rawUrl={file.rawUrl}
          openUrl={file.openUrl}
          openLabel={file.openLabel}
          description={file.description}
          onReview={onReview}
          params={params}
          paramMeta={module.train.params}
        />
      )}
    </div>
  )
}