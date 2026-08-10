/**
 * kws-streaming driver module - web target.
 *
 * The driver is plain onnxruntime-web with no DOM dependency, so it runs inside
 * the shared KWS worker (like kws-openwakeword) and needs no main-thread
 * factory. The playground entry declared in the spec lands with the first
 * trained model (there is nothing to demo until then, §2).
 */

export { KWSStreamingBackend } from '../core'
