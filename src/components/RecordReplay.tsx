import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordedClip } from '../afe'
import type { AFEPipeline } from '../afe'

interface Props {
  pipeline: AFEPipeline | null
  running: boolean
}

type PlaybackMode = 'raw' | 'processed'

export function RecordReplay({ pipeline, running }: Props) {
  const [recording, setRecording] = useState(false)
  const [recordProgress, setRecordProgress] = useState(0)
  const [clip, setClip] = useState<RecordedClip | null>(null)
  const [playing, setPlaying] = useState<PlaybackMode | null>(null)

  const playCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPlayback = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop()
      } catch {
        // Already stopped.
      }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    setPlaying(null)
  }, [])

  const handleRecord = useCallback(async () => {
    if (!pipeline || !running || recording) return
    setClip(null)
    setRecording(true)
    setRecordProgress(0)

    const duration = 10
    const start = Date.now()
    progressTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000
      setRecordProgress(Math.min(1, elapsed / duration))
    }, 100)

    try {
      const result = await pipeline.record(duration)
      setClip(result)
    } catch (err) {
      console.error('Recording failed:', err)
    } finally {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
      setRecording(false)
    }
  }, [pipeline, running, recording])

  const handlePlay = useCallback(
    (mode: PlaybackMode) => {
      if (!clip) return
      if (sourceRef.current) {
        stopPlayback()
      }

      if (!playCtxRef.current || playCtxRef.current.state === 'closed') {
        playCtxRef.current = new AudioContext()
      }
      const ctx = playCtxRef.current
      if (ctx.state === 'suspended') ctx.resume()

      const data = mode === 'raw' ? clip.raw : clip.processed
      const buffer = ctx.createBuffer(1, data.length, clip.sampleRate)
      buffer.copyToChannel(data, 0)

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.onended = () => {
        setPlaying(null)
        sourceRef.current = null
      }
      source.start()
      sourceRef.current = source
      setPlaying(mode)
    },
    [clip, stopPlayback],
  )

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopPlayback()
      playCtxRef.current?.close()
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    }
  }, [stopPlayback])

  if (!running) return null

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <h3 className="mb-4 text-sm font-semibold text-white">
        Record &amp; replay{' '}
        <span className="text-xs font-normal text-slate-500">
          · 10 s A/B comparison
        </span>
      </h3>

      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={handleRecord}
          disabled={recording}
          className={`min-w-[140px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            recording
              ? 'cursor-not-allowed bg-slate-700 text-slate-500'
              : 'bg-red-500/80 text-white hover:bg-red-500'
          }`}
        >
          {recording
            ? `Recording… ${(recordProgress * 100).toFixed(0)}%`
            : 'Record 10 s'}
        </button>

        {/* Always rendered to prevent layout shift; hidden when idle. */}
        <div
          className={`h-2 w-48 overflow-hidden rounded-full bg-slate-700 transition-opacity ${
            recording ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div
            className="h-full rounded-full bg-red-400"
            style={{ width: `${recordProgress * 100}%` }}
          />
        </div>

        {clip && !recording && (
          <>
            <button
              onClick={() => handlePlay('raw')}
              disabled={playing !== null}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                playing === 'raw'
                  ? 'bg-amber-500/30 text-amber-300'
                  : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
              }`}
            >
              {playing === 'raw' ? 'Playing raw…' : 'Play raw'}
            </button>
            <button
              onClick={() => handlePlay('processed')}
              disabled={playing !== null}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                playing === 'processed'
                  ? 'bg-emerald-500/30 text-emerald-300'
                  : 'bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50'
              }`}
            >
              {playing === 'processed'
                ? 'Playing processed…'
                : 'Play processed'}
            </button>
            {playing && (
              <button
                onClick={stopPlayback}
                className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-600"
              >
                Stop
              </button>
            )}
          </>
        )}
      </div>

      {/* Waveform comparison */}
      {clip && !recording && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-amber-300/80">
              Raw (before NS)
            </div>
            <RecordingWaveform data={clip.raw} color="#fbbf24" />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-emerald-300/80">
              Processed (after NS)
            </div>
            <RecordingWaveform data={clip.processed} color="#34d399" />
          </div>
        </div>
      )}
    </div>
  )
}

/** Static waveform overview of a recorded clip. */
function RecordingWaveform({
  data,
  color,
}: {
  data: Float32Array
  color: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    const buckets = w
    const bucketSize = Math.max(1, Math.floor(data.length / buckets))
    ctx.fillStyle = color
    for (let i = 0; i < buckets; i++) {
      let max = 0
      const start = i * bucketSize
      const end = Math.min(start + bucketSize, data.length)
      for (let j = start; j < end; j++) {
        const abs = Math.abs(data[j])
        if (abs > max) max = abs
      }
      const barH = max * h * 0.9
      const y = (h - barH) / 2
      ctx.fillRect(i, y, 1, barH)
    }
  }, [data, color])

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={64}
      className="w-full rounded bg-slate-950/60"
    />
  )
}
