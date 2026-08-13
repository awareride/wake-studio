/**
 * Training console — help drawer (issue #105).
 *
 * A collapsible "?" drawer with per-step contextual help (guide, not a
 * dedicated tab). Inline "?" buttons next to each stepper step open it;
 * a persistent "?" in the console header too. Help text lives in the
 * training module core (STEP_DEFS), so the app never hand-writes it.
 */

import { STEP_DEFS, type TrainingStepId } from '@wake-studio/module-training'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../../components/ui'
import { cn } from '../../components/cn'
import { IconTrain } from '../../components/icons'

export interface HelpDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The step the user asked about (highlighted in the drawer). */
  focusStep: TrainingStepId
}

export function HelpDrawer({ open, onOpenChange, focusStep }: HelpDrawerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        centered={false}
        className="right-0 top-0 flex h-full w-[min(92vw,23rem)] flex-col border-l"
      >
        <div className="flex items-center gap-2 border-b border-line p-4">
          <IconTrain className="h-4 w-4 text-brand-600" />
          <DialogTitle>Training guide</DialogTitle>
        </div>
        <DialogDescription className="px-4 pb-3 pt-1 text-xs text-ink-3">
          Contextual help for each step — no separate guide tab.
        </DialogDescription>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
          {STEP_DEFS.map((def) => {
            const focused = def.id === focusStep
            return (
              <section
                key={def.id}
                className={cn(
                  'rounded-xl border p-3',
                  focused ? 'border-brand-500/50 bg-brand-500/5' : 'border-line bg-surface-2',
                )}
              >
                <h4 className="text-sm font-semibold text-ink-1">
                  {STEP_DEFS.indexOf(def) + 1}. {def.label}
                </h4>
                <p className="mt-1 text-xs text-ink-2">{def.summary}</p>
                <ul className="mt-2 space-y-1.5">
                  {def.help.map((line, i) => (
                    <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-ink-2">
                      <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                      {line}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>

        <div className="border-t border-line p-4 text-[11px] leading-relaxed text-ink-3">
          Training never runs in the browser (ADR-013). Colab runs in your own
          Google account; artifacts stay client-side unless you import them
          here.
        </div>
      </DialogContent>
    </Dialog>
  )
}