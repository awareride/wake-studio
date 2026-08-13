/**
 * Training console — confirm dialog (issue #105).
 *
 * Small Radix dialog for destructive/in-flight actions: cancel a wizard,
 * leave mid-wizard via another menu, etc.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent centered className="w-[min(92vw,24rem)] p-5">
        <DialogTitle className="text-sm">{title}</DialogTitle>
        <DialogDescription className="text-xs leading-relaxed">{message}</DialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2 transition-colors hover:bg-surface-3"
          >
            Keep
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-surface-2 transition-colors hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}