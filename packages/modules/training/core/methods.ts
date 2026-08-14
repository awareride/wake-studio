/**
 * Training methods — invocation → method descriptors (issue #105).
 *
 * A trainable module declares its train methods in `spec.train.invocation`
 * (`studio-backend` | `ci` | `colab`, module-spec schema). This module maps
 * those ids to the method cards the wizard's "Choose train method" step
 * renders, including the method-specific config each one needs. Pure +
 * L1-testable.
 *
 * `studio-backend` = a runner service spawns the module's train script as a
 * child process (ADR-036; WakeStudio's implementation is `apps/studio-backend`,
 * but the PWA may point at a user-supplied backend API — the wizard's next
 * step can offer a backend picker).
 */

export type TrainMethodId = 'colab' | 'studio-backend' | 'ci'

/** Legacy persisted value (pre-rename HistoryJob rows): normalize on read. */
const LEGACY_SUBPROCESS = 'subprocess'

/** Map any stored method string onto a valid TrainMethodId. */
export function normalizeMethod(method: string | undefined): TrainMethodId {
  if (method === LEGACY_SUBPROCESS) return 'studio-backend'
  if (method === 'colab' || method === 'studio-backend' || method === 'ci') {
    return method
  }
  return 'ci'
}

export interface TrainMethod {
  id: TrainMethodId
  label: string
  /** Short pitch for the method card. */
  blurb: string
}

export const TRAIN_METHOD_ORDER: readonly TrainMethodId[] = [
  'colab',
  'studio-backend',
  'ci',
]

export const TRAIN_METHODS: Record<TrainMethodId, TrainMethod> = {
  colab: {
    id: 'colab',
    label: 'Google Colab',
    blurb:
      'Free GPU under your Google account (ADR-023). Run the module-owned notebook in your own Colab session, then bring results back in the train details pane — paste the Cloudflare tunnel URL the notebook prints (ADR-023 amendment, issue #106), or download the results zip and submit it. The URL is generated at run time, not here.',
  },
  'studio-backend': {
    id: 'studio-backend',
    label: 'Studio-backend',
    blurb:
      'A backend of your choice runs the train script (ADR-005/013/036): the WakeStudio studio-backend (uv / direct subprocess, ADR-028) or a backend you created in the app. The next step picks which backend — the train then runs there with live status.',
  },
  ci: {
    id: 'ci',
    label: 'CI',
    blurb:
      'Train in a GitHub Actions workflow (spec.train.invocation "ci"). Best for reproducible, scheduled retrains; artifacts land as workflow artifacts.',
  },
}

/** The methods a module supports, from its spec.train.invocation. */
export function methodsFor(
  invocation: readonly string[] | undefined,
): TrainMethod[] {
  if (!invocation || invocation.length === 0) {
    // No declared invocation: fall back to Colab, the v1 path.
    return [TRAIN_METHODS.colab]
  }
  return TRAIN_METHOD_ORDER.filter((id) =>
    invocation.includes(id),
  ).map((id) => TRAIN_METHODS[id])
}

/** Whether a module supports the given method. */
export function supportsMethod(
  invocation: readonly string[] | undefined,
  method: TrainMethodId,
): boolean {
  return methodsFor(invocation).some((m) => m.id === method)
}

/** The ADR-013 backend value for a train method (colab → colab, else self-hosted). */
export function backendForMethod(method: TrainMethodId): 'colab' | 'self-hosted' {
  return method === 'colab' ? 'colab' : 'self-hosted'
}
