/**
 * React WebGL spectrogram (Spectro-style, ADR-032).
 *
 * Wraps {@link SpectrogramWebGLRenderer} in a canvas component. The parent
 * feeds it one magnitude column per visualization frame (from the AFE
 * worklet's `spectrogram` field); the component keeps the time history in a
 * circular Float32 texture on the GPU and renders it with the Spectro
 * fragment shader (mel frequency axis, sensitivity/contrast, Lab color ramp).
 *
 * The frequency resolution is INDEPENDENT of the canvas display height: the
 * circular buffer stores one row per FFT bin (2048 for the default 4096-sample
 * window), and the shader's scale texture maps those 2048 rows onto the
 * canvas with bilinear filtering. This is how the reference Spectro renders
 * full-resolution spectrograms on a small canvas.
 *
 * The renderer runs its own rAF loop; new columns are uploaded lazily on the
 * next frame (a dirty flag avoids re-uploading unchanged data).
 */

import { memo, useCallback, useEffect, useRef } from 'react'
import type { SpectrogramData } from '@wake-studio/module-afe-graph'
import {
  HEATED_METAL_GRADIENT,
  SpectrogramCircularBuffer,
  SpectrogramWebGLRenderer,
} from './webgl-spectrogram'

interface Props {
  /** One Spectro-style column (magnitude bins, bin 0 = DC). */
  data?: SpectrogramData
  /** Optional per-stage override of the default render parameters. */
  sensitivity?: number
  contrast?: number
  className?: string
}

/** Fixed canvas backing size (display; frequency detail lives in the texture). */
const CANVAS_WIDTH = 256
const CANVAS_HEIGHT = 64

/**
 * Reference Spectro's initial look (its settings-panel defaults applied on
 * mount): sensitivity = 10^(0.5*3)-1 ≈ 30.6, contrast = 10^(0.5*6)-1 = 999,
 * zoom 4, mel scale, 10 Hz - 12 kHz, heated-metal gradient.
 */
const INITIAL_PARAMS = {
  sensitivity: 30.62,
  contrast: 999,
  zoom: 4,
  minFrequencyHz: 10,
  maxFrequencyHz: 12000,
  scale: 'mel' as const,
  gradient: HEATED_METAL_GRADIENT,
}

export const WebGLSpectrogram = memo(function WebGLSpectrogram({
  data,
  sensitivity,
  contrast,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<SpectrogramWebGLRenderer | null>(null)
  const bufferRef = useRef<SpectrogramCircularBuffer | null>(null)
  const binsRef = useRef(0)
  const dirtyRef = useRef(false)
  // StrictMode double-invokes effects with the SAME data reference; enqueueing
  // the same column twice would advance the ring twice. Key the guard on the
  // renderer instance so a recreated renderer (StrictMode remount) is never
  // skipped, but within one renderer's lifetime a repeated reference is.
  const consumedRef = useRef<{ renderer: object; data: SpectrogramData } | null>(null)


  /** Create (or recreate, when the bin count changes) the renderer + buffer. */
  const ensureRenderer = useCallback((bins: number) => {
    const canvas = canvasRef.current
    if (!canvas || bins <= 0) return null
    if (rendererRef.current && binsRef.current === bins) {
      return rendererRef.current
    }
    rendererRef.current?.dispose()
    rendererRef.current = null
    bufferRef.current = null
    try {
      const r = new SpectrogramWebGLRenderer(canvas, CANVAS_WIDTH, bins)
      rendererRef.current = r
      bufferRef.current = new SpectrogramCircularBuffer(CANVAS_WIDTH, bins)
      binsRef.current = bins
      r.updateParameters({ ...INITIAL_PARAMS })
      // Upload the initial (all-zero) texture so the first frames are
      // deterministic black, not uninitialized GPU memory.
      r.updateSpectrogram(bufferRef.current, true)
      return r
    } catch (err) {
      console.warn('[spectrogram] WebGL unavailable:', err)
      binsRef.current = 0
      return null
    }
  }, [])

  // Mount: run the render loop for the lifetime of the component.
  useEffect(() => {
    let rafId = 0
    const loop = () => {
      const r = rendererRef.current
      const b = bufferRef.current
      if (r && b) {
        if (dirtyRef.current) {
          r.updateSpectrogram(b)
          dirtyRef.current = false
        }
        r.render()
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
      rendererRef.current?.dispose()
      rendererRef.current = null
      bufferRef.current = null
      binsRef.current = 0
    }
  }, [])

  // Feed new columns into the circular buffer.
  useEffect(() => {
    if (!data) return
    const { column, windowSize, sampleRate } = data
    if (!column || column.length === 0) return
    const r = ensureRenderer(column.length)
    if (!r) return
    if (consumedRef.current?.renderer === r && consumedRef.current?.data === data) {
      return // same column twice (StrictMode)
    }
    consumedRef.current = { renderer: r, data }
    r.updateParameters({ windowSize, sampleRate })
    bufferRef.current?.enqueue(column)
    dirtyRef.current = true
  }, [data, ensureRenderer])

  // Live parameter updates (per-stage tuning, e.g. NS more sensitive).
  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    const next: { sensitivity?: number; contrast?: number } = {}
    if (sensitivity !== undefined) next.sensitivity = sensitivity
    if (contrast !== undefined) next.contrast = contrast
    r.updateParameters(next)
  }, [sensitivity, contrast])

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className={className ?? 'h-16 w-full rounded bg-surface-3'}
    />
  )
})
