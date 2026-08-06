/**
 * studio-backend - optional execution backend (ADR-005 Self-hosted Service).
 *
 * Zero-dependency Node http server that does the heavy lifting the PWA cannot
 * (or should not) do in the browser: running module train scripts (uv,
 * ADR-028) and, in later phases, generating SDK / model artifacts. The web
 * app is fully functional without it - training can instead run on a Cloud
 * Provider (Hugging Face, Google Cloud, ...) or Google Colab (ADR-013), or
 * against a user-supplied backend API. This server is WakeStudio's own
 * default implementation of that optional backend.
 *
 * Routes:
 *
 *   GET  /health                    -> liveness + module count
 *   GET  /modules                   -> catalog (specs + targets present)
 *   GET  /modules/:id               -> one module's spec + capabilities
 *   POST /modules/:id/train         -> run the module's train script (uv, ADR-028)
 *   GET  /modules/:id/status        -> last train result (if any)
 *
 * Routes are mounted from the module registry (module.spec.json), so adding a
 * module automatically adds its endpoints - no per-module server code.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { discoverModules, findModule } from './module-registry'
import { runTrain } from './train-runner'

export interface StudioBackendOptions {
  port?: number
  host?: string
}

export class StudioBackend {
  private readonly port: number
  private readonly host: string
  private lastTrain: Record<string, { at: string; exitCode: number }> = {}

  constructor(options: StudioBackendOptions = {}) {
    this.port = options.port ?? 4824
    this.host = options.host ?? '127.0.0.1'
  }

  /** Start the server; returns the http.Server (for tests to close). */
  listen(): ReturnType<typeof createServer> {
    const server = createServer((req, res) => this.handle(req, res))
    server.listen(this.port, this.host, () => {
      const modules = discoverModules()
      console.log(
        `[studio-backend] listening on http://${this.host}:${this.port} ` +
          `(${modules.length} module(s) discovered)`,
      )
    })
    return server
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const path = url.pathname

      if (req.method === 'GET' && path === '/health') {
        return this.json(res, 200, {
          ok: true,
          name: 'wake-studio studio-backend',
          modules: discoverModules().length,
        })
      }

      if (req.method === 'GET' && path === '/modules') {
        const modules = discoverModules().map((m) => ({
          id: m.id,
          category: m.category,
          name: m.spec.meta.name,
          version: m.spec.meta.version,
          targets: {
            node: m.hasNodeTarget,
            train: m.hasTrainTarget,
            device: m.hasDeviceTarget,
          },
          params: m.spec.params.map((p) => p.id),
          actions: m.spec.actions.map((a) => a.id),
          playground: m.spec.playground.route,
        }))
        return this.json(res, 200, { modules })
      }

      const trainMatch = path.match(/^\/modules\/([^/]+)\/train$/)
      if (req.method === 'POST' && trainMatch) {
        const mod = findModule(trainMatch[1])
        if (!mod) return this.json(res, 404, { error: `unknown module: ${trainMatch[1]}` })
        if (!mod.spec.train) return this.json(res, 400, { error: `module ${mod.id} has no train target` })

        try {
          const result = await runTrain(mod)
          this.lastTrain[mod.id] = { at: new Date().toISOString(), exitCode: result.exitCode }
          return this.json(res, result.exitCode === 0 ? 200 : 500, {
            module: mod.id,
            exitCode: result.exitCode,
            outputs: result.outputs,
          })
        } catch (err) {
          return this.json(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      }

      const statusMatch = path.match(/^\/modules\/([^/]+)\/status$/)
      if (req.method === 'GET' && statusMatch) {
        const id = statusMatch[1]
        const mod = findModule(id)
        if (!mod) return this.json(res, 404, { error: `unknown module: ${id}` })
        return this.json(res, 200, {
          module: id,
          train: this.lastTrain[id] ?? null,
        })
      }

      return this.json(res, 404, { error: `not found: ${req.method} ${path}` })
    } catch (err) {
      return this.json(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private json(res: ServerResponse, code: number, body: unknown): void {
    const text = JSON.stringify(body, null, 2)
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
    })
    res.end(text)
  }
}

/** Run when executed directly (not imported by tests). */
export function main(): void {
  const port = Number(process.env.PORT ?? 4824)
  const service = new StudioBackend({ port })
  service.listen()
}

// ESM entry guard: `import.meta.url === process.argv[1]` means direct run.
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main()
}
