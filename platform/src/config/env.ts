function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const env = {
  /** GCP project ID */
  projectId: opt('GCP_PROJECT_ID', 'billparser-dev'),

  /** Cloud Storage bucket for uploaded bills */
  storageBucket: opt('STORAGE_BUCKET', 'billparser-uploads'),

  /** Firestore collection prefix (enables multi-tenant or staging isolation) */
  firestorePrefix: opt('FIRESTORE_PREFIX', ''),

  /** Mistral API key for OCR extraction + normalization */
  mistralApiKey: opt('MISTRAL_API_KEY', ''),

  /** Mistral model for JSON structuring */
  mistralModel: opt('MISTRAL_MODEL', 'mistral-small-latest'),

  /** Gemini API key for normalization (fallback) */
  geminiApiKey: opt('GEMINI_API_KEY', ''),

  /** Gemini model for structuring (fallback) */
  geminiModel: opt('GEMINI_MODEL', 'gemini-2.5-flash'),

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
