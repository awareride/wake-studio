/**
 * Datasets — browser HTTP TTS client (ADR-044 §5.1, #208).
 *
 * The BROWSER twin of `wake_train_kit/http_tts.py`: talks to an
 * OpenAI-compatible chat.completions endpoint (MiMo speech-synthesis v2.5
 * shape: target text in an `assistant` message, style/voice instruction in a
 * `user` message; audio comes back base64 pcm16 / wav, or raw bytes). The
 * response shape parsing mirrors `extract_audio` in the backend so both
 * executors accept the same endpoints.
 *
 * Browser-only (fetch); no studio-backend involved. Credentials come from the
 * wizard/Settings, client-side only, never persisted.
 */

export interface HttpTtsOptions {
  endpoint: string
  apiKey: string
  model: string
  voice?: string
  styleInstruction?: string
  /** pcm16 | wav | mp3 — what we ask the API for (pcm16 is canonical-friendly). */
  outputFormat?: string
}

export interface HttpTtsParams {
  endpoint?: string
  apiKey?: string
  model?: string
  voice?: string
  styleInstruction?: string
  outputFormat?: string
  [key: string]: unknown
}

export class BrowserTtsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrowserTtsError'
  }
}

/** Pull audio bytes out of a chat.completions-style response (mirror of the
 *  backend `extract_audio`). */
export function extractAudio(data: unknown): Uint8Array {
  const decode = (s: string) => {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  if (data instanceof Uint8Array) return data
  if (typeof data === 'object' && data !== null) {
    const record = data as Record<string, unknown>
    const audio = record.audio
    if (typeof audio === 'string') return decode(audio)
    if (typeof audio === 'object' && audio !== null && typeof (audio as Record<string, unknown>).data === 'string') {
      return decode((audio as Record<string, unknown>).data as string)
    }
    // OpenAI chat-completions shape
    const message = (record.choices as Array<Record<string, unknown>> | undefined)?.[0]
      ?.message as Record<string, unknown> | undefined
    const content = message?.content
    if (typeof content === 'string' && content) return decode(content)
    if (typeof content === 'object' && content !== null) {
      const c = content as Record<string, unknown>
      const inner = typeof c.audio === 'string' ? c.audio : typeof c.data === 'string' ? (c.data as string) : ''
      if (inner) return decode(inner)
    }
  }
  throw new BrowserTtsError('TTS response has no parseable audio')
}

/** Fetch one synthesized clip from an online HTTP TTS endpoint. */
export async function fetchTtsClip(params: HttpTtsParams, text: string): Promise<Uint8Array> {
  const endpoint = (params.endpoint || 'https://api.xiaomimimo.com/v1').trim().replace(/\/+$/, '')
  const apiKey = params.apiKey || ''
  const model = params.model || 'mimo-v2.5-tts'
  const voice = params.voice || ''
  const style = params.styleInstruction || ''
  const outputFormat = (params.outputFormat || 'pcm16').toLowerCase()

  const userContent = [style, voice ? `voice: ${voice}` : ''].filter(Boolean).join(' ')
  const messages: Array<{ role: string; content: string }> = []
  if (userContent) messages.push({ role: 'user', content: userContent })
  messages.push({ role: 'assistant', content: text })

  let res: Response
  try {
    res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, audio: { format: outputFormat } }),
    })
  } catch (err) {
    throw new BrowserTtsError(
      `Cannot reach the TTS endpoint at ${endpoint} — is it correct and reachable? ` +
        `(network error: ${err instanceof Error ? err.message : String(err)})`,
    )
  }
  if (!res.ok) {
    throw new BrowserTtsError(`TTS endpoint returned HTTP ${res.status} for “${text}”`)
  }
  const contentType = res.headers.get('content-type') ?? ''
  let data: unknown
  if (contentType.includes('json')) {
    data = await res.json()
  } else {
    // Raw audio bytes (some endpoints return the file directly).
    data = new Uint8Array(await res.arrayBuffer())
  }
  try {
    return extractAudio(data)
  } catch (err) {
    throw new BrowserTtsError(
      err instanceof Error ? err.message : `cannot parse TTS audio for “${text}”`,
    )
  }
}
