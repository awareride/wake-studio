/**
 * Notebook personalization (issue #105 — "does my param reach the
 * notebook?").
 *
 * The module-owned .ipynb is a template: its Step-0 params cell reads env
 * vars with defaults, e.g.
 *   N_SAMPLES = int(os.environ.get("WAKE_N_SAMPLES", "1000"))
 *
 * When the user configures params in the wizard, the downloaded notebook is
 * generated from this template with the defaults REPLACED by the user's
 * values (same env var, new default), so running the notebook uses exactly
 * what was configured. Pure + L1-testable.
 */

/** A train param that maps to a notebook env var (spec.train.params). */
export interface EnvParam {
  id: string
  /** Notebook env var name (param.env). */
  env?: string
  /** The template's default value for this param (param.default). */
  default: number | boolean | string
}

interface Notebook {
  cells?: Array<{ id?: string; cell_type?: string; source?: string[] | string }>
  [k: string]: unknown
}

function joinSource(cell: { source?: string[] | string }): string {
  return Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '')
}

/** Replace the default inside `os.environ.get("ENV", "default")`. */
function replaceEnvDefault(source: string, env: string, value: string): string {
  return source.replace(
    new RegExp(`os\\.environ\\.get\\("${env}",\\s*"([^"]*)"\\)`),
    (_m, _default: string) => `os.environ.get("${env}", "${value}")`,
  )
}

/**
 * Return a NEW notebook object with the Step-0 params cell defaults replaced
 * by the user's values. Non-env params and other cells are untouched.
 * Returns the input unchanged when nothing applies.
 */
export function personalizeNotebook(
  notebook: Notebook,
  params: readonly EnvParam[],
  values: Record<string, string>,
): Notebook {
  const cellIndex = (notebook.cells ?? []).findIndex(
    (c) => c.id === 'params' || (c.cell_type === 'code' && joinSource(c).includes('os.environ.get(')),
  )
  if (cellIndex < 0) return notebook

  const cell = notebook.cells![cellIndex]
  let source = joinSource(cell)
  let changed = false

  for (const param of params) {
    if (!param.env) continue
    const value = values[param.id]
    if (value === undefined || value === null) continue
    const next = replaceEnvDefault(source, param.env, String(value))
    if (next !== source) {
      source = next
      changed = true
    }
  }

  if (!changed) return notebook

  const nextCell = { ...cell, source: source.split('\n') }
  return {
    ...notebook,
    cells: notebook.cells!.map((c, i) => (i === cellIndex ? nextCell : c)),
  }
}

/** Which params are actually baked into the notebook (for the UI note). */
export function personalizedParamIds(
  params: readonly EnvParam[],
  values: Record<string, string>,
): string[] {
  return params
    .filter((p) => p.env && values[p.id] !== undefined && values[p.id] !== null)
    .map((p) => p.id)
}