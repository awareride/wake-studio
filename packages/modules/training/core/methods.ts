/**
 * Training methods — invocation → method descriptors (issue #105).
 *
 * A trainable module declares its train methods in `spec.train.invocation`
 * (`subprocess` | `ci` | `colab`, module-spec schema). This module maps those
 * ids to the method cards the wizard's "Choose train method" step renders,
 * including the method-specific config each one needs. Pure + L1-testable.
 */

export type TrainMethodId = 'colab' | 'subprocess' | 'ci'

export interface TrainMethod {
  id: TrainMethodId
  label: string
  /** Short pitch for the method card. */
  blurb: string
  /**
   * Method-specific config the user may set (client-side only, ADR-013).
   * `urlLabel` names the field; `placeholder` hints the value.
   */
  urlConfig?: {
    key: string
    urlLabel: string
    placeholder: string
    hint: string
  }
}

export const TRAIN_METHOD_ORDER: readonly TrainMethodId[] = [
  'colab',
  'subprocess',
  'ci',
]

export const TRAIN_METHODS: Record<TrainMethodId, TrainMethod> = {
  colab: {
    id: 'colab',
    label: 'Google Colab',
    blurb:
      'Free GPU under your Google account (ADR-023). Open the module-owned notebook, run it, download the bundle — or paste the Cloudflare tunnel URL for direct control (ADR-023 amendment, issue #106).',
    urlConfig: {
      key: 'tunnelUrl',
      urlLabel: 'Colab tunnel URL',
      placeholder: 'https://xxxx.trycloudflare.com',
      hint: 'Optional for v1. With the tunnel the PWA drives Colab like the self-hosted backend (same polling + artifact download).',
    },
  },
  subprocess: {
    id: 'subprocess',
    label: 'Self-hosted service',
    blurb:
      'Your own studio-backend endpoint (ADR-005/013). The module\'s train script (spec.train.script / entry) runs locally via uv (ADR-028).',
    urlConfig: {
      key: 'endpointUrl',
      urlLabel: 'studio-backend endpoint',
      placeholder: 'http://localhost:8787',
      hint: 'The self-hosted backend URL (train-runner.ts). Lands in a later Phase 5 slice.',
    },
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