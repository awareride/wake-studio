/**
 * File input source panel (epic #53 P3).
 *
 * Lets the user add audio files (wav/mp3/ogg/flac as the browser supports),
 * see each file's channel info, and configure per-channel loop + offset.
 * Multiple files play concurrently (mixed, confirmed decision 2026-08-07).
 *
 * The decoded buffers live in memory (FileSourceItem.buffer); only the
 * metadata (name/sampleRate/durationMs/channels) is persisted in the project
 * snapshot — after a reload the user re-adds the files (P5's clip store will
 * close that gap for captured audio).
 */

import { useCallback, useRef } from 'react'
import { Button, Checkbox, Slider } from '@radix-ui/themes'
import type { FileChannelConfig, FileSourceItem } from '../workspace/types'
import { decodeAudioFile } from '../workspace/sources/fileSource'

interface Props {
  files: FileSourceItem[]
  onChange: (files: FileSourceItem[]) => void
  disabled?: boolean
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const s = ms / 1000
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1)
  return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`
}

export function FileSourcePanel({ files, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const decodeCtxRef = useRef<AudioContext | null>(null)

  const getCtx = useCallback((): AudioContext => {
    if (!decodeCtxRef.current || decodeCtxRef.current.state === 'closed') {
      decodeCtxRef.current = new AudioContext({ sampleRate: 48000 })
    }
    return decodeCtxRef.current
  }, [])

  const handleAdd = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || disabled) return
      const ctx = getCtx()
      const added: FileSourceItem[] = []
      for (const file of Array.from(fileList)) {
        try {
          const decoded = await decodeAudioFile(file, ctx)
          const channels: FileChannelConfig[] = Array.from(
            { length: decoded.channelCount },
            (_, i) => ({ index: i, loop: false, offsetMs: 0 }),
          )
          added.push({
            url: URL.createObjectURL(file),
            name: decoded.name,
            sampleRate: decoded.sampleRate,
            durationMs: decoded.durationMs,
            channels,
            buffer: decoded.buffer,
          })
        } catch {
          // Skip undecodable files; the caller can show a toast.
        }
      }
      if (added.length > 0) onChange([...files, ...added])
    },
    [files, onChange, disabled, getCtx],
  )

  const handleRemove = useCallback(
    (idx: number) => {
      const item = files[idx]
      if (item?.url) URL.revokeObjectURL(item.url)
      onChange(files.filter((_, i) => i !== idx))
    },
    [files, onChange],
  )

  const updateChannel = useCallback(
    (fileIdx: number, chIdx: number, patch: Partial<FileChannelConfig>) => {
      const next = files.map((f, fi) =>
        fi === fileIdx
          ? {
              ...f,
              channels: f.channels.map((c, ci) =>
                ci === chIdx ? { ...c, ...patch } : c,
              ),
            }
          : f,
      )
      onChange(next)
    },
    [files, onChange],
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          variant="surface"
          size="2"
        >
          + Add audio files…
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.flac"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleAdd(e.target.files)
            e.target.value = ''
          }}
        />
        <span className="text-xs text-ink-3">
          {files.length === 0
            ? 'No files — files play concurrently, each channel with its own loop + offset.'
            : `${files.length} file(s) · total ${formatDuration(files.reduce((a, f) => a + f.durationMs, 0))}`}
        </span>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, fi) => (
            <div
              key={fi}
              className="rounded-lg border border-line bg-surface-2 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink-1">
                    {f.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-3">
                    {f.sampleRate / 1000} kHz · {formatDuration(f.durationMs)} ·{' '}
                    {f.channels.length} ch
                  </span>
                </div>
                <Button
                  onClick={() => handleRemove(fi)}
                  disabled={disabled}
                  variant="ghost"
                  color="red"
                  size="1"
                  className="shrink-0 text-xs"
                >
                  Remove
                </Button>
              </div>

              {/* Per-channel rows: loop + offset */}
              <div className="mt-2 space-y-1">
                {f.channels.map((ch, ci) => (
                  <div
                    key={ci}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
                  >
                    <span className="w-20 shrink-0 text-ink-3">
                      Ch {ch.index + 1}
                    </span>
                    <label className="flex items-center gap-1.5">
                      <Checkbox
                        checked={ch.loop}
                        disabled={disabled}
                        onCheckedChange={(v) =>
                          updateChannel(fi, ci, { loop: v === true })
                        }
                        size="1"
                      />
                      <span className="text-ink-2">Loop</span>
                    </label>
                    <label className="flex items-center gap-1.5">
                      <span className="text-ink-3">Offset</span>
                      <Slider
                        min={0}
                        max={Math.max(1, Math.round(f.durationMs))}
                        step={100}
                        value={[Math.min(ch.offsetMs, Math.max(1, Math.round(f.durationMs)))]}
                        disabled={disabled}
                        onValueChange={(v) =>
                          updateChannel(fi, ci, { offsetMs: v[0] })
                        }
                        className="w-32"
                      />
                      <span className="w-14 text-right font-mono text-ink-2">
                        {(ch.offsetMs / 1000).toFixed(1)}s
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
