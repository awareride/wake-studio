/**
 * Training console — confirm dialog (issue #105).
 *
 * Small Radix dialog for destructive/in-flight actions: cancel a wizard,
 * leave mid-wizard via another menu, etc.
 */

import { Button } from '@radix-ui/themes'
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
          <Button
            type="button"
            onClick={onCancel}
            variant="outline"
            size="2"
            className="text-xs"
          >
            Keep
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            variant="solid"
            color="red"
            size="2"
            className="text-xs"
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}