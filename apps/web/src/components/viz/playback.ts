/**
 * Shared audio playback hook (epic #53 P5).
 *
 * Extracted from the old RecordReplay card (removed) so the persistence panel
 * and any future surface replay WAV clips the same way: an <audio> element
 * fed from a blob URL, with the URL revoked on stop/unmount. Pure UI helper —
 * no engine or project access.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface WavPlayback {
  /** Id of the clip currently playing (e.g. clip.id), or null. */
  playingId: string | null
  /** Start playing a WAV blob. Passing a new blob swaps the track. */
  play: (id: string, blob: Blob) => void
  /** Stop playback and release the current blob URL. */
  stop: () => void
  /** Bind to an <audio> element (ref callback). */
  attach: (el: HTMLAudioElement | null) => void
}

/**
 * Play WAV blobs through a hidden audio element. The caller binds `attach`
 * to its <audio> ref and calls `play(id, blob)`; waveform/UI can follow
 * `playingId`.
 */
export function useWavPlayback(): WavPlayback {
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current.removeAttribute('src')
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setPlayingId(null)
  }, [])

  const play = useCallback(
    (id: string, blob: Blob) => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      const audio = audioRef.current
      if (!audio) return
      audio.src = url
      audio.onended = () => {
        setPlayingId(null)
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current)
          urlRef.current = null
        }
      }
      void audio.play().catch(() => {
        // Autoplay blocked or decode failure — leave the panel idle.
        setPlayingId(null)
      })
      setPlayingId(id)
    },
    [],
  )

  const attach = useCallback(
    (el: HTMLAudioElement | null) => {
      audioRef.current = el
    },
    [],
  )

  // Release the blob URL on unmount.
  useEffect(() => stop, [stop])

  return { playingId, play, stop, attach }
}
