/**
 * Dataset module - storage plugin catalog contract (ADR-044 §5.3, task #204).
 *
 * Persistence is a StorageBackend plugin behind one interface (`push` / `pull`
 * / `list` / `delete`), the storage-side twin of the TTS engine plugins
 * (ADR-033 self-registration). The BACKEND implementations live in
 * `wake_train_kit/storage.py`; this module keeps the TYPES + the web-side
 * catalog each plugin declares its `authKey` (the Settings "Cloud storage"
 * key holding its credentials, client-side + masked).
 *
 * Backends (docs/modules/data-sources.md §5.3):
 *   backend-disk  local/default, no authKey
 *   hf            huggingface dataset repo, authKey "cloud.hf"
 *   r2            cloudflare-r2 (S3-compatible), authKey "cloud.r2"
 *   gdrive        google drive, authKey "cloud.gdrive"
 *   url           built-in / public, READ-ONLY (pull only), no authKey
 */

export type StorageBackendKind =
  | 'local'
  | 'huggingface'
  | 's3-compatible'
  | 'google-drive'
  | 'url'

export type StorageBackendCapability = 'push' | 'pull' | 'list' | 'delete'

/** One storage backend entry (the plugin descriptor). */
export interface StorageBackendDescriptor {
  id: string
  kind: StorageBackendKind
  /** Settings key holding this backend's credentials (None = no creds). */
  authKey: string | null
  capabilities: StorageBackendCapability[]
  format: 'zip'
}

/** The storage plugin catalog (static built-ins; a generated file can follow
 *  the engine-catalog pattern once storage becomes module-owned). */
export interface StorageCatalog {
  note?: string
  backends: StorageBackendDescriptor[]
}

export interface StorageCatalogValidation {
  ok: boolean
  errors: string[]
}

export const STORAGE_BACKEND_KINDS: readonly StorageBackendKind[] = [
  'local',
  'huggingface',
  's3-compatible',
  'google-drive',
  'url',
]

export const STORAGE_CAPABILITIES: readonly StorageBackendCapability[] = [
  'push',
  'pull',
  'list',
  'delete',
]

/** Built-in storage backends (mirror of wake_train_kit.storage). */
export const BUILTIN_STORAGE_BACKENDS: readonly StorageBackendDescriptor[] = [
  { id: 'backend-disk', kind: 'local', authKey: null, capabilities: ['push', 'pull', 'list', 'delete'], format: 'zip' },
  { id: 'hf', kind: 'huggingface', authKey: 'cloud.hf', capabilities: ['push', 'pull', 'list', 'delete'], format: 'zip' },
  { id: 'r2', kind: 's3-compatible', authKey: 'cloud.r2', capabilities: ['push', 'pull', 'list', 'delete'], format: 'zip' },
  { id: 'gdrive', kind: 'google-drive', authKey: 'cloud.gdrive', capabilities: ['push', 'pull', 'list', 'delete'], format: 'zip' },
  { id: 'url', kind: 'url', authKey: null, capabilities: ['pull'], format: 'zip' },
]

/** Validate a storage catalog (unique ids, known kind, valid capabilities). */
export function validateStorageCatalog(catalog: StorageCatalog): StorageCatalogValidation {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const b of catalog.backends ?? []) {
    if (!b.id) errors.push('storage backend without id')
    else if (seen.has(b.id)) errors.push(`duplicate storage backend id: ${b.id}`)
    seen.add(b.id)
    if (!STORAGE_BACKEND_KINDS.includes(b.kind)) {
      errors.push(`storage backend ${b.id}: invalid kind ${b.kind}`)
    }
    if (!Array.isArray(b.capabilities) || b.capabilities.length === 0) {
      errors.push(`storage backend ${b.id}: capabilities must be a non-empty array`)
    } else if (!b.capabilities.every((c) => STORAGE_CAPABILITIES.includes(c))) {
      errors.push(`storage backend ${b.id}: invalid capability`)
    }
    if (b.format !== 'zip') errors.push(`storage backend ${b.id}: format must be zip`)
  }
  return { ok: errors.length === 0, errors }
}

/** Look up a storage backend in a catalog by id (undefined when unknown). */
export function storageBackendById(
  catalog: StorageCatalog,
  id: string,
): StorageBackendDescriptor | undefined {
  return (catalog.backends ?? []).find((b) => b.id === id)
}

/** All distinct authKeys a storage catalog references (Settings groups). */
export function storageAuthKeys(catalog: StorageCatalog): string[] {
  return [...new Set((catalog.backends ?? []).map((b) => b.authKey).filter(Boolean) as string[])]
}
