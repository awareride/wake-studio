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
import { FileIcon } from '@radix-ui/react-icons'
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
      <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface-3 p-1">
        <button
          onClick={() => actions.updateKind('mic')}
          disabled={disabled}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50',
            source.kind === 'mic'
              ? 'bg-brand-500 text-ink-1 shadow-sm'
              : 'text-ink-2 hover:bg-surface-4',
          )}
        >
          {/* Mic: Radix UI has no mic glyph, so this stays hand-drawn. */}
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" />
          </svg>
          Microphone
        </button>
        <button
          onClick={() => actions.updateKind('file')}
          disabled={disabled}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50',
            source.kind === 'file'
              ? 'bg-brand-500 text-ink-1 shadow-sm'
              : 'text-ink-2 hover:bg-surface-4',
          )}
        >
          <FileIcon className="h-4 w-4" />
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
