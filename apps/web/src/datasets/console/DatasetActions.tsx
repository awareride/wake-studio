/**
 * Datasets console — dataset actions (ADR-044 §8, #208).
 *
 * New generation task · Train with this · Upload to cloud · Download ·
 * Delete. Built-ins are IMMUTABLE references (kind: builtin) — download /
 * delete are disabled for them (materialize on the backend instead); the
 * cloud upload dialog offers the direct browser push targets (HF wired,
 * R2/Drive flagged not-wired, #107).
 */

import { useState } from 'react'
import { Button } from '@radix-ui/themes'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui'
import { cn } from '../../components/cn'
import type { ConsoleDataset } from '../store'
import { CLOUD_TARGETS, type CloudTarget } from '../cloud-upload'
import type { StudioClient } from '../../training/studio-client'

export interface DatasetActionsProps {
  dataset: ConsoleDataset
  client: StudioClient | null
  onNew: () => void
  onTrain: (id: string) => void
  onCheck: (id: string) => void
  onSplit: (id: string, seed: number) => void
  onUpload: (dataset: ConsoleDataset, input: { target: CloudTarget; repoId: string }) => Promise<void>
  onDownload: (dataset: ConsoleDataset) => Promise<void>
  onDelete: (dataset: ConsoleDataset) => Promise<void>
}

export function DatasetActions({
  dataset,
  client,
  onNew,
  onTrain,
  onCheck,
  onSplit,
  onUpload,
  onDownload,
  onDelete,
}: DatasetActionsProps) {
  const isBuiltin = dataset.kind === 'builtin'
  const hasBytes =
    dataset.origin === 'local' ||
    (dataset.origin === 'backend' && !!client) ||
    dataset.origin === 'builtin'
  const canRunBackendOps = !!client && dataset.origin === 'backend'

  const [uploadOpen, setUploadOpen] = useState(false)
  const [target, setTarget] = useState<CloudTarget>('hf')
  const [repoId, setRepoId] = useState('')
  const [busy, setBusy] = useState<null | 'upload' | 'download' | 'delete'>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const targetMeta = CLOUD_TARGETS.find((c) => c.id === target)!

  const runUpload = async () => {
    setBusy('upload')
    setError(null)
    try {
      await onUpload(dataset, { target, repoId })
      setUploadOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <section className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Actions</h4>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="1" onClick={onNew} className="font-medium">
            New generation task
          </Button>
          <Button
            type="button"
            size="1"
            variant="soft"
            onClick={() => onTrain(dataset.id)}
            title="Open the Training wizard with this dataset pre-picked"
          >
            Train with this
          </Button>
          <Button type="button" size="1" variant="soft" onClick={() => setUploadOpen(true)}>
            Upload to cloud
          </Button>
          <Button
            type="button"
            size="1"
            variant="soft"
            disabled={!canRunBackendOps}
            onClick={() => onCheck(dataset.id)}
            title={
              canRunBackendOps
                ? 'Run the check-dataset quality job (clip quality, silence/duplication, voice coverage) on the studio-backend'
                : 'Requires a connected studio-backend (backend-stored dataset)'
            }
          >
            Check
          </Button>
          {canRunBackendOps && (
            <SplitButton dataset={dataset} onSplit={onSplit} />
          )}
          <Button
            type="button"
            size="1"
            variant="outline"
            disabled={!hasBytes || isBuiltin || busy === 'download'}
            onClick={() => void onDownload(dataset).then(() => setBusy(null)).catch(() => setBusy(null))}
            title={isBuiltin ? 'Built-ins are immutable references — materialize them on the backend to download.' : 'Download the canonical wake-studio-dataset.zip'}
          >
            {busy === 'download' ? 'Downloading…' : 'Download'}
          </Button>
          <Button
            type="button"
            size="1"
            variant="outline"
            color="red"
            disabled={isBuiltin || busy === 'delete'}
            onClick={() => setDeleteOpen(true)}
            title={isBuiltin ? 'Built-ins are immutable references and cannot be deleted.' : 'Delete this dataset'}
          >
            Delete
          </Button>
        </div>
        {isBuiltin && (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            Built-ins are immutable references (
            {dataset.note ?? 'materialized on the backend on first use'}). Use them in
            training directly; download/delete are not applicable.
          </p>
        )}
      </section>

      {/* Upload-to-cloud dialog. */}
      <Dialog open={uploadOpen} onOpenChange={(o) => !o && setUploadOpen(false)}>
        <DialogContent centered className="w-[min(92vw,26rem)] p-5">
          <DialogTitle className="text-sm">Upload “{dataset.name}” to cloud</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-ink-3">
            Direct browser push of the canonical zip using your Settings cloud credentials
            (client-side, masked, never persisted).
          </DialogDescription>

          <div className="mt-3 space-y-1.5">
            {CLOUD_TARGETS.map((c) => (
              <label
                key={c.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                  target === c.id
                    ? 'border-brand-9/60 bg-brand-9/10'
                    : 'border-line bg-surface-3',
                )}
              >
                <input
                  type="radio"
                  className="mt-0.5 accent-[var(--brand-9)]"
                  checked={target === c.id}
                  onChange={() => setTarget(c.id)}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink-1">
                    {c.label}
                    {!c.wired && (
                      <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-3">
                        not wired browser-side
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] leading-relaxed text-ink-3">{c.note}</span>
                </span>
              </label>
            ))}
          </div>

          {target === 'hf' && (
            <div className="mt-3">
              <label htmlFor="hf-repo-upload" className="block text-xs font-medium text-ink-2">
                Hugging Face repo id
              </label>
              <input
                id="hf-repo-upload"
                value={repoId}
                onChange={(e) => setRepoId(e.target.value)}
                placeholder="your-user/wake-words-zh-en"
                className="mt-1 w-full rounded-lg border border-line bg-surface-1 px-3 py-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-8"
              />
              <p className="mt-1 text-[11px] text-ink-3">
                Token comes from Settings → Cloud storage → Hugging Face.
              </p>
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs leading-relaxed text-danger">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" onClick={() => setUploadOpen(false)} variant="outline" size="2" className="text-xs">
              Keep
            </Button>
            <Button
              type="button"
              onClick={() => void runUpload()}
              disabled={!targetMeta.wired || busy === 'upload' || (target === 'hf' && !repoId.trim())}
              size="2"
              className="text-xs"
            >
              {busy === 'upload' ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm. */}
      <Dialog open={deleteOpen} onOpenChange={(o) => !o && setDeleteOpen(false)}>
        <DialogContent centered className="w-[min(92vw,24rem)] p-5">
          <DialogTitle className="text-sm">Delete “{dataset.name}”?</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {dataset.origin === 'backend'
              ? 'Removes the dataset from the backend store (its zip + index). Datasets that feed an existing train keep working through their copied materialization.'
              : 'Removes this dataset from the browser-local store. This cannot be undone unless you have the zip elsewhere.'}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" onClick={() => setDeleteOpen(false)} variant="outline" size="2" className="text-xs">
              Keep
            </Button>
            <Button
              type="button"
              color="red"
              size="2"
              className="text-xs"
              onClick={() => {
                setDeleteOpen(false)
                setBusy('delete')
                void onDelete(dataset).finally(() => setBusy(null))
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Split action — the reproducible train/val/test op (#209).
 *
 * Prompts for the reproducibility seed (default 0 → recipe.seed parity), then
 * runs the backend `dataset-split` job which emits a NEW dataset zip with the
 * partition recorded in its manifest (`split { seed, ratios, train/val/test }`).
 */
function SplitButton({
  dataset,
  onSplit,
}: {
  dataset: ConsoleDataset
  onSplit: (id: string, seed: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [seed, setSeed] = useState('0')
  const seedNumber = Number.parseInt(seed, 10) || 0

  return (
    <>
      <Button
        type="button"
        size="1"
        variant="soft"
        onClick={() => setOpen(true)}
        title="Split into a fixed train/val/test partition (reproducible, no leakage) and save it as a new dataset"
      >
        Split…
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent centered className="w-[min(92vw,24rem)] p-5">
          <DialogTitle className="text-sm">Split “{dataset.name}”</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-ink-3">
            Records a fixed train/val/test partition (80/10/10) in a new dataset’s manifest.
            Near-duplicate clips stay in one partition — evaluation never sees training data.
          </DialogDescription>
          <label htmlFor="split-seed" className="mt-3 block text-xs font-medium text-ink-2">
            Reproducibility seed
          </label>
          <input
            id="split-seed"
            inputMode="numeric"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-surface-1 px-3 py-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-8"
          />
          <p className="mt-1 text-[11px] text-ink-3">
            Same dataset + seed → identical partition every time (byte-reproducible).
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)} variant="outline" size="2" className="text-xs">
              Keep
            </Button>
            <Button
              type="button"
              size="2"
              className="text-xs"
              onClick={() => {
                setOpen(false)
                onSplit(dataset.id, seedNumber)
              }}
            >
              Split
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
