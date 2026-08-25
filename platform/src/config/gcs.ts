/**
 * Google Cloud Storage client.
 *
 * Uses @google-cloud/storage directly. firebase-admin previously wrapped this
 * same client, but Firestore is gone after the Postgres migration and storage
 * was its only remaining use — the wrapper bought nothing and pulled in a large
 * dependency tree.
 *
 * Credentials come from Application Default Credentials: the runtime service
 * account on Cloud Run, `gcloud auth application-default login` locally.
 */
import { Storage } from '@google-cloud/storage';
import { env } from './env.js';

let _storage: Storage | undefined;

export function storage(): Storage {
  if (!env.projectId) {
    throw new Error(
      'GCP_PROJECT_ID is not set. Refusing to fall back to a default project — '
      + 'an unset value previously resolved to the live project. Set it in platform/.env '
      + '(local) or via --set-env-vars (Cloud Run).',
    );
  }
  if (!_storage) _storage = new Storage({ projectId: env.projectId });
  return _storage;
}

/** The configured uploads bucket. Throws rather than defaulting to any bucket. */
export function bucket() {
  if (!env.storageBucket) {
    throw new Error(
      'STORAGE_BUCKET is not set. Refusing to fall back to a default bucket — '
      + 'an unset value previously resolved to the live production bucket.',
    );
  }
  return storage().bucket(env.storageBucket);
}
