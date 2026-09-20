/**
 * Model export license gate (Phase 4 prep).
 *
 * Selecting a model for export runs the commercial license gate
 * (`isCommerciallyUsable`). If the model is usable, the export action is
 * enabled as a stub (real export kits land in Phase 4 / device SDK).
 * If not, the gate blocks with an explanation.
 */

import * as React from 'react'
import type { RegistryModel } from '@wake-studio/platform'
import { isCommerciallyUsable } from '@wake-studio/platform'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogClose,
} from '../components/ui'
import { Button } from '@radix-ui/themes'
import { useToast } from '../components/toast'
import { cn } from '../components/cn'
import { useT } from '../i18n'

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
  const t = useT()
  const usable = isCommerciallyUsable(model)
  const [target, setTarget] = React.useState<string>('onnx')

  // Reset target when a new model opens the dialog.
  React.useEffect(() => {
    if (open) setTarget('onnx')
  }, [open, model.id])

  const handleExport = () => {
    // Stub: Phase 4 wires the actual export kit builder here.
    toast({
      title: t('Export requested'),
      description: `${model.id} → ${target} (${t('export kits land in Phase 4')}).`,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{`${t('Export')} ${model.name}`}</DialogTitle>
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
            {usable ? `✓ ${t('Commercially usable')}` : `⚠ ${t('License gate: export blocked')}`}
          </div>
          <p className="mt-1 text-xs text-ink-2">
            {usable
              ? t('This model is redistributable and explicitly commercial — safe to bundle.')
              : `${t('This model is')} ${model.class}. ${t('It cannot be used in a commercial bundle (Phase 4 gate).')}`}
          </p>
        </div>

        {/* Target selection */}
        <div className="mt-4">
          <div className="mb-2 text-sm text-ink-2">{t('Export target')}</div>
          <div className="grid grid-cols-1 gap-2">
            {TARGETS.map((targetOption) => (
              <button
                key={targetOption.value}
                onClick={() => setTarget(targetOption.value)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm',
                  target === targetOption.value
                    ? 'border-brand-9 bg-brand-9/10 text-ink-1'
                    : 'border-line bg-surface-3 text-ink-2 hover:bg-surface-4',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full border',
                    target === targetOption.value ? 'border-brand-9' : 'border-line-2',
                  )}
                >
                  {target === targetOption.value && <span className="h-2 w-2 rounded-full bg-brand-9" />}
                </span>
                {t(targetOption.label)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline" size="2">
              {t('Cancel')}
            </Button>
          </DialogClose>
          <Button
            onClick={handleExport}
            disabled={!usable}
            size="2"
            title={usable ? undefined : t('Blocked by the license gate')}
          >
            {t('Export')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
