/**
 * kws-plix driver module - core exports.
 * Driver boundary stub; the PLiX embed provider engine lands in
 * module-migration §6.3 (moved from apps/web/src/kws/backends/).
 */

export const PLIX_ENCODERS = ['base', 'small'] as const
export type PlixEncoder = (typeof PLIX_ENCODERS)[number]

export interface PlixDriverOptions {
  /** ONNX model URL (base-resolved) or a transformers repo id. */
  modelUrl: string
  encoder: PlixEncoder
  embeddingDim: number
}
