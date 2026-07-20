function opt(name: string, fallback: string): string {
  const raw = process.env[name] ?? process.env[name.trim()];
  if (raw == null) return fallback;
  const v = raw.trim();
  return v === '' ? fallback : v;
}

function req(name: string): string {
  const v = opt(name, '');
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const env = {
  /** GCP project ID */
  projectId: opt('GCP_PROJECT_ID', 'billparser-dev'),

  /** Cloud Storage bucket for uploaded bills (private — served via signed URL or API proxy) */
  storageBucket: opt('STORAGE_BUCKET', 'billparser-uploads'),

  /** Firestore collection prefix (enables multi-tenant or staging isolation) */
  firestorePrefix: opt('FIRESTORE_PREFIX', ''),

  /** Firestore database ID (named database). Use "(default)" for the default DB. */
  firestoreDatabaseId: opt('FIRESTORE_DATABASE_ID', '(default)'),

  /** Mistral API key for OCR extraction + normalization */
  mistralApiKey: opt('MISTRAL_API_KEY', ''),

  /** Mistral model for JSON structuring */
  mistralModel: opt('MISTRAL_MODEL', 'mistral-small-latest'),

  /** Gemini API key for normalization (fallback) */
  geminiApiKey: opt('GEMINI_API_KEY', ''),

  /** Gemini model for structuring (fallback) */
  geminiModel: opt('GEMINI_MODEL', 'gemini-2.5-flash'),

  /**
   * Vertex AI location for Gemini when using ADC (no API key).
   * "global" is required for Gemini 3.x models (they 404 on regional endpoints
   * in this project as of 2026-07); Gemini 2.5 models work fine via global too.
   */
  vertexLocation: opt('VERTEX_LOCATION', 'global'),

  /** Signed URL lifetime in minutes for private GCS objects */
  signedUrlTtlMinutes: Number(opt('SIGNED_URL_TTL_MINUTES', '60')),

  /** Server port */
  port: Number(opt('PORT', '4000')),

  /** Node environment */
  nodeEnv: opt('NODE_ENV', 'development'),

  /** Local in-memory mode — no GCP/Firestore needed */
  localDev: opt('LOCAL_DEV', 'false') === 'true',

  /** Known buyer GSTINs — never use as vendor (comma-separated, e.g. fleet operator) */
  buyerGstinBlocklist: opt('BUYER_GSTIN_BLOCKLIST', '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
} as const;
