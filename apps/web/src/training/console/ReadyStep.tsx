/**
 * Training wizard — Step 4: Ready to start (issue #105).
 *
 * Reviews the train (module + params + method) and shows the train input
 * file for review — for Colab the .ipynb notebook, previewed on the panel.
 * The CTA is honest per method: Colab cannot be started from the app (the
 * run happens in the user's Colab session), so the button SAVES/CONFIRMS the
 * train and opens its details pane; subprocess/ci label it "Start train" for
 * the future.
 */

import { type TrainMethodId } from '@wake-studio/module-training'
import type { TrainableModule } from '../train-modules'
import { FileReviewCard } from './FileReviewCard'
import { trainInputFile } from './train-files'
import { cn } from '../../components/cn'

export interface ReadyStepProps {
  module: TrainableModule
  method: TrainMethodId
  params: Record<string, string>
  onStart: () => void
  starting?: boolean
}

function methodLabel(method: TrainMethodId): string {
  return method === 'colab' ? 'Google Colab' : method === 'subprocess' ? 'Self-hosted service' : 'CI'
}

export function ReadyStep({ module, method, params, onStart, starting }: ReadyStepProps) {
  const file = trainInputFile(module, method)
  const labels = new Map(
    (module.train.params ?? []).map((p) => [p.id, p.label]),
  )
  const paramRows = Object.entries(params)
  const isColab = method === 'colab'

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

      <div className="space-y-2">
        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          className={cn(
            'rounded-lg bg-brand-500 px-5 py-2 text-sm font-semibold text-ink-1 transition-colors hover:bg-brand-400',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {starting
            ? 'Saving…'
            : isColab
              ? `Save ${methodLabel(method)} train`
              : `Start ${methodLabel(method)} train`}
        </button>
        {isColab && (
          <p className="text-[11px] leading-relaxed text-ink-3">
            This just saves and confirms the train here — the run happens in your own Colab
            session (run the notebook, then bring results back in the train details pane:
            tunnel URL, or download + submit the results zip).
          </p>
        )}
      </div>
    </div>
  )
}