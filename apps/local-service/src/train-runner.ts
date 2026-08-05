/**
 * local-service - train runner (ADR-028).
 *
 * Spawns a module's train script via `uv run` in the module's train/
 * directory, streams stdout/stderr, and resolves with the outputs declared in
 * the module spec (spec.train.outputs).
 *
 * Both the local service and CI (train-<module>.yml) invoke the SAME path -
 * one code path, two callers.
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type { RegisteredModule } from './module-registry'

export interface TrainRunOptions {
  /** Extra args passed to the train script. */
  args?: string[]
  /** Override output dir (defaults to <module>/train/out). */
  outDir?: string
  /** Optional env vars (e.g. ML env). */
  env?: Record<string, string>
}

export interface TrainResult {
  exitCode: number
  stdout: string
  stderr: string
  /** Absolute paths of the declared outputs (may be absent for no-op runs). */
  outputs: Record<string, string>
}

/** Run a module's train script with uv (ADR-028). */
export async function runTrain(
  module: RegisteredModule,
  options: TrainRunOptions = {},
): Promise<TrainResult> {
  const train = module.spec.train
  if (!train) {
    throw new Error(`module ${module.id} has no train target in its spec`)
  }
  if (!module.hasTrainTarget) {
    throw new Error(`module ${module.id} has no train/ directory`)
  }

  const trainDir = resolve(module.dir, 'train')
  const outDir = resolve(options.outDir ?? resolve(trainDir, 'out'))

  // train.entry is relative to the MODULE root (e.g. "train/train.py", per
  // spec.train.entry); resolve it against the train dir for uv.
  const entryRel = train.entry.replace(/^train\//, '')

  const args = [
    'run',
    '--project',
    trainDir,
    'python',
    entryRel,
    ...(options.args ?? []),
  ]

  return new Promise<TrainResult>((resolvePromise, reject) => {
    const child = spawn('uv', args, {
      cwd: trainDir,
      env: {
        ...process.env,
        MODULE_OUT_DIR: outDir,
        ...options.env,
      },
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d
      process.stdout.write(`[${module.id} train] ${d}`)
    })
    child.stderr.on('data', (d) => {
      stderr += d
      process.stderr.write(`[${module.id} train] ${d}`)
    })

    child.on('error', (err) => {
      reject(new Error(`failed to spawn uv for ${module.id}: ${err.message}`))
    })
    child.on('close', (code) => {
      const outputs: Record<string, string> = {}
      for (const [name, rel] of Object.entries(train.outputs)) {
        outputs[name] = resolve(outDir, rel.replace(/^out\//, ''))
      }
      resolvePromise({
        exitCode: code ?? -1,
        stdout,
        stderr,
        outputs,
      })
    })
  })
}
