/**
 * local-service - HTTP server tests (L1, real sockets).
 *
 * Starts the LocalService on an ephemeral port and exercises the module
 * catalog + health endpoints. Train is tested separately (spawns uv).
 */

import { describe, it, expect, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { LocalService } from '../src/server'

let server: Server | undefined
let baseUrl = ''

async function start(): Promise<string> {
  if (server) return baseUrl
  // Port 0 -> ephemeral.
  const service = new LocalService({ port: 0 })
  server = service.listen()
  await new Promise<void>((resolve) => server!.on('listening', () => resolve()))
  const addr = server!.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
  return baseUrl
}

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`)
  return { status: res.status, body: await res.json() }
}

describe('local-service HTTP', () => {
  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
  })

  it('health reports ok + module count', async () => {
    await start()
    const { status, body } = await get('/health')
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
    expect((body as { modules: number }).modules).toBeGreaterThanOrEqual(1)
  })

  it('catalog lists the rnnoise module with targets', async () => {
    await start()
    const { status, body } = await get('/modules')
    expect(status).toBe(200)
    const { modules } = body as { modules: Array<{ id: string; category: string; targets: { train: boolean } }> }
    const rnnoise = modules.find((m) => m.id === 'rnnoise')
    expect(rnnoise?.category).toBe('afe')
    expect(rnnoise?.targets.train).toBe(true)
  })

  it('unknown module returns 404', async () => {
    await start()
    const { status } = await get('/modules/nope')
    expect(status).toBe(404)
  })
})
