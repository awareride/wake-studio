/**
 * Step A — input source editor (epic #53 P7, plan §8.1 Step A).
 *
 * Mic device picker + browser DSP toggles, or the file list editor. Moved out
 * of the AFE panel so it renders in the Phase 1 configure flow next to the
 * component-selection canvas; the AFE panel reads the same state via the
 * `SourceState` props when the pipeline starts.
 */

import { SourceSelector } from './SourceSelector'
import { FileSourcePanel } from './FileSourcePanel'
import type { SourceState, SourceActions } from '../workspace/useSourceConfig'
import { cn } from './cn'

interface Props {
  source: SourceState
  actions: SourceActions
  disabled?: boolean
}

export function SourceConfigSection({ source, actions, disabled }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-3 p-1">
        <button
          onClick={() => actions.updateKind('mic')}
          disabled={disabled}
          className={cn(
            'rounded-md px-3 py-1 text-sm font-medium transition-colors disabled:opacity-50',
            source.kind === 'mic'
              ? 'bg-brand-500 text-ink-1'
              : 'text-ink-2 hover:bg-surface-4',
          )}
        >
          Microphone
        </button>
        <button
          onClick={() => actions.updateKind('file')}
          disabled={disabled}
          className={cn(
            'rounded-md px-3 py-1 text-sm font-medium transition-colors disabled:opacity-50',
            source.kind === 'file'
              ? 'bg-brand-500 text-ink-1'
              : 'text-ink-2 hover:bg-surface-4',
          )}
        >
          Audio files
        </button>
      </div>
      {source.kind === 'mic' ? (
        <SourceSelector
          value={source.mic}
          onChange={actions.updateMic}
          disabled={disabled}
        />
      ) : (
        <div className="rounded-xl border border-line bg-surface-3 p-4">
          <FileSourcePanel
            files={source.files}
            onChange={actions.updateFiles}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  )
}
