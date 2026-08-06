/**
 * WebGL spectrogram renderer (Spectro-style, ADR-032).
 *
 * A direct TypeScript port of the reference Spectro visualizer's GPU renderer
 * (https://github.com/calebj0seph/spectro - MIT):
 *
 *   - The spectrogram time history lives in a **circular Float32 texture**
 *     whose width equals the canvas width (one column per pixel). Only the new
 *     columns are uploaded each frame (`texSubImage2D`), so rendering never
 *     re-uploads the whole history.
 *   - A fullscreen-quad **fragment shader** maps each screen pixel to a
 *     (frequency, time) sample via two lookup textures: a frequency **scale
 *     texture** (linear or mel) and a **gradient texture** (Lab-interpolated
 *     color ramp). Sensitivity, contrast and zoom are uniforms applied on the
 *     GPU, so live parameter changes are cheap and smooth.
 *   - The circular wrap is handled in the shader with `mod()`, matching the
 *     reference (non-power-of-two textures cannot use REPEAT wrapping).
 *
 * The web app uses this instead of the old 2D-canvas per-pixel renderer: GPU
 * scaling/colorization is what makes the spectrogram look like the reference.
 *
 * WebGL1 + `OES_texture_float` + `OES_texture_float_linear` are required (no
 * WebGL2 dependency) so it runs everywhere the reference runs.
 */

export type SpectrogramScale = 'linear' | 'mel'

export interface SpectrogramRenderParameters {
  /** Multiplicative gain applied to FFT magnitudes before colorizing. */
  sensitivity: number
  /** log(1 + i*c)/log(1+c) contrast curve. */
  contrast: number
  /** Time-axis zoom (how many columns per screen pixel). */
  zoom: number
  /** Lowest displayed frequency in Hz. */
  minFrequencyHz: number
  /** Highest displayed frequency in Hz. */
  maxFrequencyHz: number
  /** Sample rate the columns were computed at. */
  sampleRate: number
  /** FFT window size the columns were computed with. */
  windowSize: number
  /** Frequency-axis scale (mel gives more weight to lower frequencies). */
  scale: SpectrogramScale
  /** Color gradient (Lab-interpolated stops). */
  gradient: SpectrogramGradient
}

/** Gradient stops: [position, [r, g, b]] (0..255 each). */
export type SpectrogramGradient = ReadonlyArray<readonly [number, [number, number, number]]>

/** Heated-metal default (matches the reference Spectro look). */
export const HEATED_METAL_GRADIENT: SpectrogramGradient = [
  [0.0, [0, 0, 0]],
  [0.3, [128, 0, 128]],
  [0.65, [255, 0, 0]],
  [0.9, [255, 255, 0]],
  [1.0, [255, 255, 255]],
]

/** Audacity-style gradient (from the reference's color-util). */
export const AUDACITY_GRADIENT: SpectrogramGradient = [
  [0.0, [191, 191, 191]],
  [0.25, [76, 153, 255]],
  [0.5, [229, 25, 229]],
  [0.75, [255, 0, 0]],
  [1.0, [255, 255, 255]],
]

const VERTEX_SHADER = `
attribute vec4 aVertexPos;
attribute vec2 aVertexTexCoord;
varying vec2 vVertexTexCoord;
void main() {
  gl_Position = aVertexPos;
  vVertexTexCoord = aVertexTexCoord;
}
`

const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D uSpectrogramSampler;
uniform sampler2D uScaleSampler;
uniform sampler2D uGradientSampler;
uniform float uSpectrogramOffset;
uniform float uSpectrogramLength;
uniform vec2 uScaleRange;
uniform float uContrast;
uniform float uSensitivity;
uniform float uZoom;
varying vec2 vVertexTexCoord;

void main() {
    float sampleX = texture2D(
        uScaleSampler,
        vec2(
            0.0,
            uScaleRange.y - uScaleRange.y * vVertexTexCoord.y + uScaleRange.x * vVertexTexCoord.y
        )
    ).r;

    float sampleY = mod(
        clamp((vVertexTexCoord.x - 1.0) / uZoom + uSpectrogramLength, 0.0, 1.0) + uSpectrogramOffset,
        1.0
    );

    float intensity = clamp(
        texture2D(uSpectrogramSampler, vec2(sampleX, sampleY)).r * uSensitivity,
        0.0,
        1.0
    );
    if (uContrast > 0.0) {
        intensity = log(1.0 + intensity * uContrast) / log(1.0 + uContrast);
    }

    // Prevent wrapping issues when the spectrogram is smaller than the screen
    if ((vVertexTexCoord.x - 1.0) / uZoom + uSpectrogramLength <= 0.0) {
        intensity = 0.0;
    }

    vec3 color = texture2D(uGradientSampler, vec2(0.0, intensity)).rgb;
    gl_FragColor = vec4(color.r, color.g, color.b, 1.0);
}
`

/** A circular 2D buffer of Float32 columns (matches Spectro's Circular2DBuffer). */
export class SpectrogramCircularBuffer {
  /** Number of columns (time axis, = texture width). */
  width: number
  /** Number of rows (frequency bins, = texture height). */
  height: number
  start = 0
  length = 0
  data: Float32Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Float32Array(width * height)
  }

  enqueue(column: Float32Array): void {
    const col = column.length <= this.height ? column : column.subarray(0, this.height)
    const x = (this.start + this.length) % this.width
    this.data.set(col, x * this.height)
    this.length += 1
    if (this.length > this.width) {
      this.start = (this.start + this.length - this.width) % this.width
      this.length = this.width
    }
  }

  clear(): void {
    this.data.fill(0)
    this.start = 0
    this.length = 0
  }
}

export class SpectrogramWebGLRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: WebGLRenderingContext

  private readonly program: {
    program: WebGLProgram
    positionAttribute: number
    texCoordAttribute: number
    spectrogramSampler: WebGLUniformLocation
    scaleSampler: WebGLUniformLocation
    gradientSampler: WebGLUniformLocation
    spectrogramOffset: WebGLUniformLocation
    spectrogramLength: WebGLUniformLocation
    scaleRange: WebGLUniformLocation
    contrast: WebGLUniformLocation
    sensitivity: WebGLUniformLocation
    zoom: WebGLUniformLocation
  }

  private vertexBuffer: WebGLBuffer
  private indexBuffer: WebGLBuffer

  private spectrogramTexture: WebGLTexture | null = null
  private scaleTexture: WebGLTexture | null = null
  private gradientTexture: WebGLTexture | null = null

  private spectrogramHeight: number

  private spectrogramLength = 0
  private spectrogramOffset = 0
  private lastSpectrogramStart: number | null = null
  private lastSpectrogramLength = 0

  private parameters: SpectrogramRenderParameters | null = null
  private scaleRange: [number, number] = [0, 0]
  private currentScaleRange: [number, number] = [0, 0]
  private currentContrast = 25
  private currentSensitivity = 25
  private currentZoom = 4

  private resizeHandlerZoomOverride = 1
  private resizeHandlerLastRealWidth = 0

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.canvas = canvas
    const ctx = canvas.getContext('webgl') as WebGLRenderingContext | null
    if (ctx === null) {
      throw new Error('Unable to create WebGL context')
    }
    this.ctx = ctx

    if (ctx.getExtension('OES_texture_float') === null) {
      throw new Error('OES_texture_float extension is not supported')
    }
    if (ctx.getExtension('OES_texture_float_linear') === null) {
      throw new Error('OES_texture_float_linear extension is not supported')
    }

    const program = this.loadProgram(VERTEX_SHADER, FRAGMENT_SHADER)
    this.program = {
      program,
      positionAttribute: ctx.getAttribLocation(program, 'aVertexPos'),
      texCoordAttribute: ctx.getAttribLocation(program, 'aVertexTexCoord'),
      spectrogramSampler: this.getUniformLocation(program, 'uSpectrogramSampler'),
      scaleSampler: this.getUniformLocation(program, 'uScaleSampler'),
      gradientSampler: this.getUniformLocation(program, 'uGradientSampler'),
      spectrogramOffset: this.getUniformLocation(program, 'uSpectrogramOffset'),
      spectrogramLength: this.getUniformLocation(program, 'uSpectrogramLength'),
      scaleRange: this.getUniformLocation(program, 'uScaleRange'),
      contrast: this.getUniformLocation(program, 'uContrast'),
      sensitivity: this.getUniformLocation(program, 'uSensitivity'),
      zoom: this.getUniformLocation(program, 'uZoom'),
    }

    const [vertexBuffer, indexBuffer] = this.createFullscreenQuad()
    this.vertexBuffer = vertexBuffer
    this.indexBuffer = indexBuffer

    ctx.pixelStorei(ctx.UNPACK_ALIGNMENT, 1)

    this.spectrogramHeight = height
    this.spectrogramTexture = this.createSpectrogramTexture(height, width)

    this.updateParameters({})
  }

  // ---- public API ----

  render(): void {
    const { ctx, program } = this
    ctx.clearColor(0.0, 0.0, 0.0, 1.0)
    ctx.clear(ctx.COLOR_BUFFER_BIT)

    ctx.bindBuffer(ctx.ARRAY_BUFFER, this.vertexBuffer)
    ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, this.indexBuffer)

    ctx.vertexAttribPointer(program.positionAttribute, 2, ctx.FLOAT, false, 16, 0)
    ctx.enableVertexAttribArray(program.positionAttribute)
    ctx.vertexAttribPointer(program.texCoordAttribute, 2, ctx.FLOAT, false, 16, 8)
    ctx.enableVertexAttribArray(program.texCoordAttribute)

    ctx.useProgram(program.program)
    ctx.uniform1f(program.spectrogramOffset, this.spectrogramOffset)
    ctx.uniform1f(program.spectrogramLength, this.spectrogramLength)

    // Smooth parameter changes (LERP toward target each frame).
    const LERP_AMOUNT = 0.5
    const params = this.parameters!
    this.currentScaleRange = [
      stepTowards(this.currentScaleRange[0], this.scaleRange[0], LERP_AMOUNT),
      stepTowards(this.currentScaleRange[1], this.scaleRange[1], LERP_AMOUNT),
    ]
    this.currentContrast = stepTowards(this.currentContrast, params.contrast, LERP_AMOUNT)
    if (this.currentContrast < 0.05) this.currentContrast = 0.0
    this.currentSensitivity = stepTowards(this.currentSensitivity, params.sensitivity, LERP_AMOUNT)
    this.currentZoom = stepTowards(this.currentZoom, params.zoom, LERP_AMOUNT)

    ctx.uniform2fv(program.scaleRange, this.currentScaleRange)
    ctx.uniform1f(program.contrast, this.currentContrast)
    ctx.uniform1f(program.sensitivity, this.currentSensitivity)
    ctx.uniform1f(program.zoom, this.resizeHandlerZoomOverride * this.currentZoom)

    ctx.activeTexture(ctx.TEXTURE0)
    ctx.bindTexture(ctx.TEXTURE_2D, this.spectrogramTexture)
    ctx.uniform1i(program.spectrogramSampler, 0)

    ctx.activeTexture(ctx.TEXTURE1)
    ctx.bindTexture(ctx.TEXTURE_2D, this.scaleTexture)
    ctx.uniform1i(program.scaleSampler, 1)

    ctx.activeTexture(ctx.TEXTURE2)
    ctx.bindTexture(ctx.TEXTURE_2D, this.gradientTexture)
    ctx.uniform1i(program.gradientSampler, 2)

    ctx.drawElements(ctx.TRIANGLES, 6, ctx.UNSIGNED_SHORT, 0)
  }

  /** Full resize (called on window resize, debounced). */
  resizeCanvas(width: number, height: number): void {
    this.lastSpectrogramStart = null
    this.resizeHandlerZoomOverride = 1
    this.resizeHandlerLastRealWidth = width
    this.canvas.width = width
    this.canvas.height = height
    this.ctx.viewport(0, 0, width, height)
  }

  /** Fast resize (mid-drag: preserve the zoom-relative time mapping). */
  fastResizeCanvas(width: number, height: number): void {
    this.resizeHandlerZoomOverride = this.resizeHandlerLastRealWidth / width
    this.canvas.width = width
    this.canvas.height = height
    this.ctx.viewport(0, 0, width, height)
  }

  updateParameters(partial: Partial<SpectrogramRenderParameters>): void {
    const p = this.parameters
    const next: SpectrogramRenderParameters = {
      sensitivity: merge(partial.sensitivity, p?.sensitivity, 25),
      contrast: merge(partial.contrast, p?.contrast, 25),
      zoom: merge(partial.zoom, p?.zoom, 4),
      minFrequencyHz: merge(partial.minFrequencyHz, p?.minFrequencyHz, 10),
      maxFrequencyHz: merge(partial.maxFrequencyHz, p?.maxFrequencyHz, 12000),
      sampleRate: merge(partial.sampleRate, p?.sampleRate, 48000),
      windowSize: merge(partial.windowSize, p?.windowSize, 4096),
      scale: merge(partial.scale, p?.scale, 'mel'),
      gradient: merge(partial.gradient, p?.gradient, HEATED_METAL_GRADIENT),
    }

    if (p === null || p.gradient !== next.gradient) {
      this.updateGradientTexture(next.gradient)
    }

    const freqParamsChanged =
      p === null ||
      p.scale !== next.scale ||
      p.minFrequencyHz !== next.minFrequencyHz ||
      p.maxFrequencyHz !== next.maxFrequencyHz ||
      p.sampleRate !== next.sampleRate ||
      p.windowSize !== next.windowSize

    if (freqParamsChanged) {
      this.updateScaleRange(
        next.scale,
        next.minFrequencyHz,
        next.maxFrequencyHz,
        next.sampleRate,
        next.windowSize,
      )
    }

    const scaleParamsChanged =
      p === null ||
      p.scale !== next.scale ||
      p.sampleRate !== next.sampleRate ||
      p.windowSize !== next.windowSize

    if (scaleParamsChanged) {
      this.updateScaleTexture(next.scale, next.sampleRate, next.windowSize)
      this.currentScaleRange = this.scaleRange
    }

    this.parameters = next
  }

  /** Upload new columns to the circular texture (only the new columns). */
  updateSpectrogram(buffer: SpectrogramCircularBuffer, forceFull = false): void {
    const { ctx } = this
    const texture = this.spectrogramTexture!
    ctx.bindTexture(ctx.TEXTURE_2D, texture)

    if (forceFull || this.lastSpectrogramStart === null) {
      ctx.texImage2D(
        ctx.TEXTURE_2D,
        0,
        ctx.LUMINANCE,
        buffer.height,
        buffer.width,
        0,
        ctx.LUMINANCE,
        ctx.FLOAT,
        buffer.data,
      )
    } else if (buffer.start !== this.lastSpectrogramStart) {
      if (buffer.start >= this.lastSpectrogramStart) {
        this.updateSpectrogramPartial(
          buffer.height,
          buffer.start - this.lastSpectrogramStart,
          this.lastSpectrogramStart,
          buffer.data,
        )
      } else {
        this.updateSpectrogramPartial(buffer.height, buffer.start, 0, buffer.data)
        this.updateSpectrogramPartial(
          buffer.height,
          buffer.width - this.lastSpectrogramStart,
          this.lastSpectrogramStart,
          buffer.data,
        )
      }
    } else if (buffer.length > this.lastSpectrogramLength) {
      this.updateSpectrogramPartial(
        buffer.height,
        buffer.length - this.lastSpectrogramLength,
        this.lastSpectrogramLength,
        buffer.data,
      )
    }

    this.lastSpectrogramLength = buffer.length
    this.lastSpectrogramStart = buffer.start
    this.spectrogramOffset = buffer.start / buffer.width
    this.spectrogramLength =
      -0.5 / buffer.width + buffer.length / buffer.width
  }

  /** Recreate the circular texture at a new width (history preserved). */
  resizeSpectrogramBuffer(buffer: SpectrogramCircularBuffer, newWidth: number): void {
    if (newWidth === buffer.width) return
    // Rebuild the buffer preserving the newest columns (Spectro's resizeWidth).
    const newData = new Float32Array(newWidth * buffer.height)
    for (let i = 0; i < Math.min(buffer.length, newWidth); i++) {
      const newX = Math.min(buffer.length, newWidth) - i - 1
      const oldX = (buffer.start + buffer.length - i - 1) % buffer.width
      newData.set(
        buffer.data.subarray(oldX * buffer.height, (oldX + 1) * buffer.height),
        newX * buffer.height,
      )
    }
    buffer.data = newData
    buffer.width = newWidth
    if (buffer.length >= newWidth) buffer.length = newWidth
    buffer.start = 0
    this.lastSpectrogramStart = null
  }

  dispose(): void {
    const { ctx } = this
    for (const tex of [this.spectrogramTexture, this.scaleTexture, this.gradientTexture]) {
      if (tex) ctx.deleteTexture(tex)
    }
    ctx.deleteBuffer(this.vertexBuffer)
    ctx.deleteBuffer(this.indexBuffer)
    ctx.deleteProgram(this.program.program)
    this.spectrogramTexture = null
    this.scaleTexture = null
    this.gradientTexture = null
  }

  // ---- internals ----

  private updateSpectrogramPartial(
    width: number,
    height: number,
    dataStart: number,
    data: Float32Array,
  ): void {
    // The texture is laid out transposed relative to the circular buffer:
    //   texture.x = frequency bin (bins wide), texture.y = column (columns
    //   tall), while the buffer stores columns contiguously as
    //   data[column * bins + bin]. A sub-image therefore spans
    //   x:[0, bins) x y:[dataStart, dataStart + columnCount), which is the
    //   data range [dataStart*bins, (dataStart+columnCount)*bins).
    this.ctx.texSubImage2D(
      this.ctx.TEXTURE_2D,
      0,
      0,
      dataStart,
      width,
      height,
      this.ctx.LUMINANCE,
      this.ctx.FLOAT,
      data.subarray(dataStart * width, (dataStart + height) * width),
    )
  }

  private getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation {
    const location = this.ctx.getUniformLocation(program, name)
    if (location === null) {
      throw new Error(`Could not get uniform location for ${name}`)
    }
    return location
  }

  private loadProgram(vertexSrc: string, fragmentSrc: string): WebGLProgram {
    const vertex = this.loadShader(this.ctx.VERTEX_SHADER, vertexSrc)
    const fragment = this.loadShader(this.ctx.FRAGMENT_SHADER, fragmentSrc)
    const program = this.ctx.createProgram()
    if (!program) throw new Error('Failed to create program')
    this.ctx.attachShader(program, vertex)
    this.ctx.attachShader(program, fragment)
    this.ctx.linkProgram(program)
    if (!this.ctx.getProgramParameter(program, this.ctx.LINK_STATUS)) {
      const error = this.ctx.getProgramInfoLog(program)
      this.ctx.deleteProgram(program)
      throw new Error(`Failed to link program:\n${error}`)
    }
    return program
  }

  private loadShader(type: number, src: string): WebGLShader {
    const shader = this.ctx.createShader(type)
    if (!shader) throw new Error('Could not create shader')
    this.ctx.shaderSource(shader, src)
    this.ctx.compileShader(shader)
    if (!this.ctx.getShaderParameter(shader, this.ctx.COMPILE_STATUS)) {
      const error = this.ctx.getShaderInfoLog(shader)
      this.ctx.deleteShader(shader)
      throw new Error(`Failed to compile shader:\n${error}`)
    }
    return shader
  }

  private createFullscreenQuad(): [WebGLBuffer, WebGLBuffer] {
    const { ctx } = this
    const vertexBuffer = ctx.createBuffer()
    const indexBuffer = ctx.createBuffer()
    if (!vertexBuffer || !indexBuffer) throw new Error('Could not create buffers')

    ctx.bindBuffer(ctx.ARRAY_BUFFER, vertexBuffer)
    ctx.bufferData(
      ctx.ARRAY_BUFFER,
      new Float32Array([
        // (x, y, u, v)
        -1.0, 1.0, 0.0, 0.0,
        -1.0, -1.0, 0.0, 1.0,
        1.0, -1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 0.0,
      ]),
      ctx.STATIC_DRAW,
    )

    ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, indexBuffer)
    ctx.bufferData(ctx.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 3, 2, 3, 1]), ctx.STATIC_DRAW)

    return [vertexBuffer, indexBuffer]
  }

  private createSpectrogramTexture(width: number, height: number): WebGLTexture {
    const { ctx } = this
    const texture = ctx.createTexture()
    if (!texture) throw new Error('Could not create texture')

    ctx.bindTexture(ctx.TEXTURE_2D, texture)
    ctx.texImage2D(
      ctx.TEXTURE_2D,
      0,
      ctx.LUMINANCE,
      width,
      height,
      0,
      ctx.LUMINANCE,
      ctx.FLOAT,
      new Float32Array(width * height),
    )
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR)
    return texture
  }

  private updateScaleRange(
    scale: SpectrogramScale,
    minFrequencyHz: number,
    maxFrequencyHz: number,
    sampleRate: number,
    windowSize: number,
  ): void {
    const peakHz = (sampleRate * (windowSize - 2)) / (2 * windowSize)
    switch (scale) {
      case 'linear':
        this.scaleRange = [minFrequencyHz / peakHz, maxFrequencyHz / peakHz]
        break
      case 'mel':
        this.scaleRange = [
          Math.log(1 + minFrequencyHz / 700) / Math.log(1 + peakHz / 700),
          Math.log(1 + maxFrequencyHz / 700) / Math.log(1 + peakHz / 700),
        ]
        break
    }
  }

  private updateScaleTexture(scale: SpectrogramScale, sampleRate: number, windowSize: number): void {
    const { ctx } = this
    const buffer = new Float32Array(this.spectrogramHeight)
    for (let i = 0; i < this.spectrogramHeight; i++) {
      switch (scale) {
        case 'linear':
          buffer[i] = i / (this.spectrogramHeight - 1)
          break
        case 'mel': {
          const peakHz = (sampleRate * (windowSize - 2)) / (2 * windowSize)
          buffer[i] =
            (700 * ((1 + peakHz / 700) ** (i / (this.spectrogramHeight - 1)) - 1)) / peakHz
          break
        }
      }
    }

    if (this.scaleTexture === null) {
      this.scaleTexture = ctx.createTexture()
    }
    ctx.bindTexture(ctx.TEXTURE_2D, this.scaleTexture)
    ctx.texImage2D(
      ctx.TEXTURE_2D,
      0,
      ctx.LUMINANCE,
      1,
      this.spectrogramHeight,
      0,
      ctx.LUMINANCE,
      ctx.FLOAT,
      buffer,
    )
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR)
  }

  private updateGradientTexture(gradient: SpectrogramGradient): void {
    const { ctx } = this
    const SIZE = 128
    const buffer = new Uint8Array(SIZE * 3)
    for (let i = 0; i < SIZE; i++) {
      const [r, g, b] = colorRampLab(i / (SIZE - 1), gradient)
      buffer[i * 3] = r
      buffer[i * 3 + 1] = g
      buffer[i * 3 + 2] = b
    }

    if (this.gradientTexture === null) {
      this.gradientTexture = ctx.createTexture()
    }
    ctx.bindTexture(ctx.TEXTURE_2D, this.gradientTexture)
    ctx.texImage2D(
      ctx.TEXTURE_2D,
      0,
      ctx.RGB,
      1,
      SIZE,
      0,
      ctx.RGB,
      ctx.UNSIGNED_BYTE,
      buffer,
    )
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR)
  }
}

// ---------------------------------------------------------------------------
// Helpers (ported from the reference math-util/color-util)
// ---------------------------------------------------------------------------

function merge<T>(newValue: T | undefined, oldValue: T | undefined, defaultValue: T): T {
  if (newValue !== undefined) return newValue
  if (oldValue !== undefined) return oldValue
  return defaultValue
}

function stepTowards(x: number, y: number, amount: number): number {
  if (Math.abs(x - y) < 1e-9) return y
  return x + amount * (y - x)
}

// --- Lab-interpolated color ramp (reference color-util) ---

function addGamma(u: number): number {
  if (u <= 0.0031308) return 12.92 * u
  return 1.055 * u ** (1 / 2.4) - 0.055
}

function removeGamma(u: number): number {
  if (u <= 0.04045) return u / 12.92
  return ((u + 0.055) / 1.055) ** 2.4
}

function fLab(t: number): number {
  const x = 6 / 29
  if (t > x ** 3) return t ** (1 / 3)
  return t / (3 * x * x) + 4 / 29
}

function fLabInverse(t: number): number {
  const x = 6 / 29
  if (t > x) return t ** 3
  return 3 * x * x * (t - 4 / 29)
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lR = removeGamma(r / 255)
  const lG = removeGamma(g / 255)
  const lB = removeGamma(b / 255)
  const x = 0.4124 * lR + 0.3576 * lG + 0.1805 * lB
  const y = 0.2126 * lR + 0.7152 * lG + 0.0722 * lB
  const z = 0.0193 * lR + 0.1192 * lG + 0.9505 * lB
  return [
    116 * fLab(y / 100) - 16,
    500 * (fLab(x / 95.0489) - fLab(y / 100)),
    200 * (fLab(y / 100) - fLab(z / 108.884)),
  ]
}

function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const x = 95.0489 * fLabInverse((l + 16) / 116 + a / 500)
  const y = 100 * fLabInverse((l + 16) / 116)
  const z = 108.884 * fLabInverse((l + 16) / 116 - b / 200)
  const lR = 3.2406 * x - 1.5372 * y - 0.4986 * z
  const lG = -0.9689 * x + 1.8758 * y + 0.0415 * z
  const lB = 0.0557 * x - 0.204 * y + 1.057 * z
  return [
    Math.floor(Math.min(255, Math.max(0, 256 * addGamma(lR)))),
    Math.floor(Math.min(255, Math.max(0, 256 * addGamma(lG)))),
    Math.floor(Math.min(255, Math.max(0, 256 * addGamma(lB)))),
  ]
}

function colorRampLab(x: number, gradient: SpectrogramGradient): [number, number, number] {
  const t = Math.min(1, Math.max(0, x))
  let startIdx = 0
  let endIdx = 0
  for (let i = 0; i < gradient.length; i++) {
    if (gradient[i][0] >= t) {
      endIdx = i
      startIdx = i > 0 ? i - 1 : endIdx
      break
    }
  }
  const local =
    startIdx === endIdx
      ? 0
      : (t - gradient[startIdx][0]) / (gradient[endIdx][0] - gradient[startIdx][0])
  const ease = (u: number) => (u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u)
  const start = rgbToLab(...gradient[startIdx][1])
  const end = rgbToLab(...gradient[endIdx][1])
  return labToRgb(
    start[0] + (end[0] - start[0]) * ease(local),
    start[1] + (end[1] - start[1]) * ease(local),
    start[2] + (end[2] - start[2]) * ease(local),
  )
}
