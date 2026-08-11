/**
 * User model library - index.
 *
 * IndexedDB-backed store for user-supplied KWS models (local file imports and
 * future training artifacts) AND provisioned artifacts (enrolled prototypes
 * today; ADR-033) - one browsable collection.
 */

export {
  importModelFile,
  listUserModels,
  deleteUserModel,
  exportUserModel,
  blobUrlForModel,
  saveProvisionArtifact,
  listProvisionArtifacts,
  getProvisionArtifact,
  deleteProvisionArtifact,
} from './store'
export type { UserModel, UserArtifact } from './store'
