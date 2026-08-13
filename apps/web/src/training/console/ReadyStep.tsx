/**
 * Training wizard — Step 4: Ready to start (issue #105).
 *
 * Reviews the train (module + params + method) and shows the train input
 * file for review — for Colab this is the .ipynb notebook (download + Open
 * in Colab). The Start button is the wizard's primary CTA; starting opens
 * this train's review pane.
 */

import type { TrainMethodId } from '@wake-studio/module-training'
import type { TrainableModule } from '../train-modules'
import { FileReviewCard } from './FileReviewCard'
import { trainInputFile } from './train-files'
import { cn } from '../../components/cn'

export interface ReadyStepProps {
  module: TrainableModule
  method: TrainMethodId
  params: Record<string, string>
  /** The values the wizard will pass to the job (param id → label). */
  onStart: () => void
  starting?: boolean
}

export function ReadyStep({ module, method, params, onStart, starting }: ReadyStepProps) {
  const file = trainInputFile(module, method)
  const methodLabel =
    method === 'colab' ? 'Google Colab' : method === 'subprocess' ? 'Self-hosted service' : 'CI'

  const paramRows = Object.entries(params)

  return (
    <div className="space-y-4">
      {/* Train summary. */}
      <div className="rounded-xl border border-line bg-surface-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink-1">Ready to start</h3>
          <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
            {module.id}
          </span>
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success">
            {methodLabel}
          </span>
        </div>

        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          {paramRows.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3">
              <dt className="text-ink-3">{key}</dt>
              <dd className="truncate font-mono text-ink-1" title={value}>
                {value || '—'}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Inputs review: the file that actually trains. */}
      {file && (
        <FileReviewCard
          title={file.title}
          fileName={file.fileName}
          kind={file.kind}
          rawUrl={file.rawUrl}
          openUrl={file.openUrl}
          openLabel={file.openLabel}
          description={file.description}
        />
      )}

      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className={cn(
          'rounded-lg bg-brand-500 px-5 py-2 text-sm font-semibold text-ink-1 transition-colors hover:bg-brand-400',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {starting ? 'Starting…' : `Start ${methodLabel} train`}
      </button>
    </div>
  )
}