#!/usr/bin/env node
/**
 * Generate the module status table for README (ADR-025 §4).
 *
 * Walks packages/modules/<category>/<module>/spec/module.spec.json, computes a
 * maturity scorecard per module (scoreModule), and prints a markdown table
 * (module id, category, maturity, scorecard axes) - so the README status table
 * is generated from scorecards, never hand-maintained.
 *
 * Usage:
 *   node scripts/gen-module-status.mjs            # print table (stdout)
 *   node scripts/gen-module-status.mjs --update   # write to README.md
 *
 * Evidence flags are inferred from the filesystem: core = core/ exists with
 * a .ts entry, tests = tests/*.test.ts exist, playground = spec.playground,
 * targets = spec.runtime has web+local/cloud/device. Panel evidence = the
 * module renders via renderPanel (spec-driven; assumed true when spec.params
 * are non-empty - the generator covers all current modules).
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { discoverModules } from './lib/module-discovery.mjs'

const repoRoot = resolve(import.meta.dirname, '..')

/** Infer maturity evidence flags from the filesystem + spec (ADR-025 §4). */
function evidenceFor({ dir, spec }) {
  const hasCore =
    existsSync(resolve(dir, 'core', 'index.ts')) || existsSync(resolve(dir, 'core', 'index.js'))
  const hasTests = (() => {
    try {
      return readdirSync(resolve(dir, 'tests')).some((f) => f.endsWith('.test.ts'))
    } catch {
      return false
    }
  })()
  const evidence = {
    core: hasCore,
    spec: true,
    panel: (spec.params ?? []).length > 0,
    tests: hasTests,
    playground: Boolean(spec.playground?.entry),
    targets: Boolean(spec.runtime?.web),
  }
  return evidence
}

// Minimal scoreModule reimplementation here (importing module-kit pulls React
// + Radix; this script is Node-only and must stay dependency-free).
function scoreModule(spec, evidence) {
  const axes = {
    core: evidence.core,
    spec: evidence.spec,
    panel: evidence.panel,
    tests: evidence.tests,
    playground: evidence.playground,
    targets: evidence.targets,
  }
  const done = Object.values(axes).filter(Boolean).length
  const total = Object.keys(axes).length
  return { axes, pct: Math.round((done / total) * 100), done, total }
}

function main() {
  const modules = discoverModules()
    .map((m) => ({ ...m, evidence: evidenceFor(m) }))
    .sort(
      (a, b) =>
        a.spec.meta.category.localeCompare(b.spec.meta.category) ||
        a.spec.meta.id.localeCompare(b.spec.meta.id),
    )

  const rows = modules.map(({ spec, evidence }) => {
    const s = scoreModule(spec, evidence)
    const marks = ['core', 'spec', 'panel', 'tests', 'playground', 'targets']
      .map((a) => (s.axes[a] ? '✅' : '⬜'))
      .join('')
    return `| \`${spec.meta.id}\` | ${spec.meta.category} | ${spec.meta.maturity} | ${marks} | ${s.pct}% |`
  })

  const table = [
    '| Module | Category | Maturity | Core Spec Panel Tests Playground Targets | Score |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n')

  const block = `<!-- MODULE-STATUS:generated -->\n${table}\n<!-- /MODULE-STATUS -->`

  const update = process.argv.includes('--update')
  if (update) {
    const readme = resolve(repoRoot, 'README.md')
    const text = readFileSync(readme, 'utf8')
    const start = text.indexOf('<!-- MODULE-STATUS:generated -->')
    const end = text.indexOf('<!-- /MODULE-STATUS -->')
    if (start === -1 || end === -1) {
      console.error('README.md has no MODULE-STATUS markers; add them first.')
      process.exit(1)
    }
    const next = text.slice(0, start) + block + text.slice(end + '<!-- /MODULE-STATUS -->'.length)
    writeFileSync(readme, next)
    console.log(`Updated README.md (${modules.length} modules).`)
  } else {
    console.log(block)
  }
}

main()
