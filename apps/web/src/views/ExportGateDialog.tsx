/**
 * Model export license gate (Phase 4 prep).
 *
 * Selecting a model for export runs the commercial license gate
 * (`isCommerciallyUsable`). If the model is usable, the export action is
 * enabled as a stub (real export kits land in Phase 4 / device SDK).
 * If not, the gate blocks with an explanation.
 */

import * as React from 'react'
import type { RegistryModel } from '../data/registry'
import { isCommerciallyUsable } from '../data/registry'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogClose,
} from '../components/ui'
import { useToast } from '../components/toast'
import { cn } from '../components/cn'

interface ExportGateDialogProps {
  model: RegistryModel
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TARGETS = [
  { value: 'onnx', label: 'ONNX' },
  { value: 'tflite', label: 'TFLite (int8 quantized)' },
  { value: 'device-sdk', label: 'Device SDK bundle' },
] as const

export function ExportGateDialog({ model, open, onOpenChange }: ExportGateDialogProps) {
  const { toast } = useToast()
  const usable = isCommerciallyUsable(model)
  const [target, setTarget] = React.useState<string>('onnx')

  // Reset target when a new model opens the dialog.
  React.useEffect(() => {
    if (open) setTarget('onnx')
  }, [open, model.id])

  const handleExport = () => {
    // Stub: Phase 4 wires the actual export kit builder here.
    toast({
      title: 'Export requested',
      description: `${model.id} → ${target} (export kits land in Phase 4).`,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Export {model.name}</DialogTitle>
        <DialogDescription>
          {model.license} · {model.source}
        </DialogDescription>

        {/* License gate */}
        <div
          className={cn(
            'mt-4 rounded-lg border p-3 text-sm',
            usable
              ? 'border-success/30 bg-success/5 text-ink-1'
              : 'border-amber-400/40 bg-amber-500/5 text-ink-1',
          )}
        >
          <div className="font-medium">
            {usable ? '✓ Commercially usable' : '⚠ License gate: export blocked'}
          </div>
          <p className="mt-1 text-xs text-ink-2">
            {usable
              ? 'This model is redistributable and explicitly commercial — safe to bundle.'
              : `This model is ${model.class}. It cannot be used in a commercial bundle (Phase 4 gate).`}
          </p>
        </div>

        {/* Target selection */}
        <div className="mt-4">
          <div className="mb-2 text-sm text-ink-2">Export target</div>
          <div className="grid grid-cols-1 gap-2">
            {TARGETS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTarget(t.value)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm',
                  target === t.value
                    ? 'border-brand-500 bg-brand-500/10 text-ink-1'
                    : 'border-line bg-surface-3 text-ink-2 hover:bg-surface-4',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full border',
                    target === t.value ? 'border-brand-500' : 'border-line-2',
                  )}
                >
                  {target === t.value && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <button className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-3">
              Cancel
            </button>
          </DialogClose>
          <button
            onClick={handleExport}
            disabled={!usable}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium',
              usable
                ? 'bg-brand-500 text-ink-1 hover:bg-brand-400'
                : 'cursor-not-allowed bg-surface-4 text-ink-3',
            )}
            title={usable ? undefined : 'Blocked by the license gate'}
          >
            Export
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
