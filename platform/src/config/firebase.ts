import { initializeApp, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';
import { env } from './env.js';

let app: App | undefined;

function ensureApp(): App {
  if (!app) {
    app = initializeApp({
      projectId: env.projectId,
      storageBucket: env.storageBucket,
    });
  }
  return app;
}

let _db: Firestore | undefined;
export function db(): Firestore {
  if (!_db) {
    _db = getFirestore(ensureApp());
    _db.settings({ ignoreUndefinedProperties: true });
  }
  return _db;
}

let _storage: Storage | undefined;
export function storage(): Storage {
  if (!_storage) _storage = getStorage(ensureApp());
  return _storage;
}

/** Prefixed collection name for multi-tenant / staging isolation. */
export function col(name: string): string {
  return env.firestorePrefix ? `${env.firestorePrefix}_${name}` : name;
}
