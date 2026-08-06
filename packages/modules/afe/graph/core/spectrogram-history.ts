/**
 * Contiguous ring buffer for spectrogram columns (ADR-032).
 *
 * The AFE's processing buffer (CIRCULAR_BUFFER_SIZE = 1920 samples) wraps long
 * before a 4096-sample FFT window is available, so the spectrogram needs its
 * own history that keeps the newest `size` samples as a *contiguous* copy.
 *
 * `push` appends chunks (worklet quanta) and, when full, memmoves the tail to
 * the front so `window()` can always hand back a contiguous window. This keeps
 * the AudioWorklet's `spectrogramColumn` call allocation-light (it reads a
 * plain subarray) and correct across the wrap boundary.
 */
export class SpectrogramHistory {
  readonly size: number
  private data: Float32Array
  private write = 0
  private filled = 0

  constructor(size: number) {
    if (size <= 0) throw new Error(`SpectrogramHistory size must be > 0, got ${size}`)
    this.size = size
    this.data = new Float32Array(size)
  }

  get length(): number {
    return this.filled
  }

  /** Append samples; evicts the oldest when full (memmove to keep contiguity). */
  push(samples: Float32Array): void {
    const n = samples.length
    if (n === 0) return
    if (n >= this.size) {
      // New data alone fills the window: keep only the newest `size` samples.
      this.data.set(samples.subarray(n - this.size))
      this.write = this.size
      this.filled = this.size
      return
    }
    const free = this.size - this.write
    if (n <= free) {
      this.data.set(samples, this.write)
      this.write += n
    } else {
      this.data.set(samples.subarray(0, free), this.write)
      this.data.set(samples.subarray(free), 0)
      this.write = n - free
    }
    this.filled = Math.min(this.size, this.filled + n)
  }

  /**
   * A contiguous Float32Array of the newest `windowSize` samples
   * (zero-padded at the front if fewer than `windowSize` have been pushed).
   */
  window(windowSize: number): Float32Array {
    const out = new Float32Array(windowSize)
    const take = Math.min(this.filled, windowSize)
    if (take === 0) return out
    const start = (this.write - take + this.size) % this.size
    const dest = windowSize - take
    if (start + take <= this.size) {
      out.set(this.data.subarray(start, start + take), dest)
    } else {
      const first = this.size - start
      out.set(this.data.subarray(start), dest)
      out.set(this.data.subarray(0, take - first), dest + first)
    }
    return out
  }

  clear(): void {
    this.data.fill(0)
    this.write = 0
    this.filled = 0
  }
}
