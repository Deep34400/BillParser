/**
 * Drizzle schema — single source of truth for the Postgres shape.
 * Mirrors src/shared/types.ts (BillDoc, BillPartDoc) and the users/vendor domain
 * types. Enums are TEXT + CHECK, not native pg ENUM, so adding a new status/type
 * value later is an ordinary migration instead of an ALTER TYPE dance.
 */
import { sql } from 'drizzle-orm';
import {
  pgTable, text, timestamp, numeric, integer, real, jsonb, boolean, check, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─── vendors ────────────────────────────────────────────────────────────────

export const vendors = pgTable('vendors', {
  vendorId: text('vendor_id').primaryKey(),
  legalName: text('legal_name'),
  displayName: text('display_name'),
  gstin: text('gstin'),
  pan: text('pan'),
  invoiceCount: integer('invoice_count').notNull().default(0),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull(),
  parserName: text('parser_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [
  index('vendors_gstin_idx').on(t.gstin),
  index('vendors_pan_idx').on(t.pan),
  index('vendors_legalname_idx').on(sql`lower(${t.legalName})`),
  index('vendors_count_idx').on(t.invoiceCount.desc()),
]);

// ─── bills ──────────────────────────────────────────────────────────────────

export const bills = pgTable('bills', {
  billId: text('bill_id').primaryKey(),
  fleetId: text('fleet_id'),
  vehicleId: text('vehicle_id'),

  billType: text('bill_type').notNull(),
  billCategory: text('bill_category'),

  vendorName: text('vendor_name'),
  vendorGstin: text('vendor_gstin'),
  vendorId: text('vendor_id').references(() => vendors.vendorId, { onDelete: 'set null' }),

  companyName: text('company_name'),
  gstin: text('gstin'),
  pan: text('pan'),
  irn: text('irn'),

  invoiceNumber: text('invoice_number'),
  invoiceDate: text('invoice_date'),
  invoiceTime: text('invoice_time'),

  subtotalAmount: numeric('subtotal_amount', { mode: 'number', precision: 14, scale: 2 }),
  partsAmount: numeric('parts_amount', { mode: 'number', precision: 14, scale: 2 }),
  labourAmount: numeric('labour_amount', { mode: 'number', precision: 14, scale: 2 }),

  partsCgstAmount: numeric('parts_cgst_amount', { mode: 'number', precision: 14, scale: 2 }),
  partsSgstAmount: numeric('parts_sgst_amount', { mode: 'number', precision: 14, scale: 2 }),
  partsIgstAmount: numeric('parts_igst_amount', { mode: 'number', precision: 14, scale: 2 }),
  partsCgstRate: numeric('parts_cgst_rate', { mode: 'number', precision: 6, scale: 3 }),
  partsSgstRate: numeric('parts_sgst_rate', { mode: 'number', precision: 6, scale: 3 }),
  partsIgstRate: numeric('parts_igst_rate', { mode: 'number', precision: 6, scale: 3 }),

  labourCgstAmount: numeric('labour_cgst_amount', { mode: 'number', precision: 14, scale: 2 }),
  labourSgstAmount: numeric('labour_sgst_amount', { mode: 'number', precision: 14, scale: 2 }),
  labourIgstAmount: numeric('labour_igst_amount', { mode: 'number', precision: 14, scale: 2 }),
  labourCgstRate: numeric('labour_cgst_rate', { mode: 'number', precision: 6, scale: 3 }),
  labourSgstRate: numeric('labour_sgst_rate', { mode: 'number', precision: 6, scale: 3 }),
  labourIgstRate: numeric('labour_igst_rate', { mode: 'number', precision: 6, scale: 3 }),

  totalTaxAmount: numeric('total_tax_amount', { mode: 'number', precision: 14, scale: 2 }),
  grandTotalAmount: numeric('grand_total_amount', { mode: 'number', precision: 14, scale: 2 }),

  deductibles: numeric('deductibles', { mode: 'number', precision: 14, scale: 2 }),
  salvage: numeric('salvage', { mode: 'number', precision: 14, scale: 2 }),

  odometerReading: integer('odometer_reading'),
  registrationNumber: text('registration_number'),
  chassisNumber: text('chassis_number'),

  ocrStatus: text('ocr_status').notNull(),
  processingStatus: text('processing_status'),
  confidenceScore: real('confidence_score'),

  reviewReasons: text('review_reasons').array(),

  fileUrl: text('file_url'),
  storagePath: text('storage_path'),

  rawOcrReference: text('raw_ocr_reference'),
  parsedData: jsonb('parsed_data'),

  pipelineMode: text('pipeline_mode'),
  extractionCostUsd: numeric('extraction_cost_usd', { mode: 'number', precision: 18, scale: 10 }),
  structuringCostUsd: numeric('structuring_cost_usd', { mode: 'number', precision: 18, scale: 10 }),
  totalCostUsd: numeric('total_cost_usd', { mode: 'number', precision: 18, scale: 10 }),
  extractionTokens: integer('extraction_tokens'),
  extractionInputTokens: integer('extraction_input_tokens'),
  extractionOutputTokens: integer('extraction_output_tokens'),
  structuringTokens: integer('structuring_tokens'),
  structuringInputTokens: integer('structuring_input_tokens'),
  structuringOutputTokens: integer('structuring_output_tokens'),
  totalTokens: integer('total_tokens'),
  totalInputTokens: integer('total_input_tokens'),
  totalOutputTokens: integer('total_output_tokens'),
  totalThinkingTokens: integer('total_thinking_tokens'),
  totalInputCostUsd: numeric('total_input_cost_usd', { mode: 'number', precision: 18, scale: 10 }),
  totalOutputCostUsd: numeric('total_output_cost_usd', { mode: 'number', precision: 18, scale: 10 }),
  extractionProvider: text('extraction_provider'),
  structuringProvider: text('structuring_provider'),
  extractionModel: text('extraction_model'),
  structuringModel: text('structuring_model'),
  extractionLatencyMs: integer('extraction_latency_ms'),
  structuringLatencyMs: integer('structuring_latency_ms'),
  totalLatencyMs: integer('total_latency_ms'),

  /** Pages billed by a per-page extraction step (Mistral OCR). */
  extractionPages: integer('extraction_pages'),

  /** $/1M model rates this cost was computed with. Stored so the figure stays
      reproducible (tokens × rate = cost) after someone edits pricing in Settings. */
  inputRatePer1m: numeric('input_rate_per_1m', { mode: 'number', precision: 18, scale: 10 }),
  outputRatePer1m: numeric('output_rate_per_1m', { mode: 'number', precision: 18, scale: 10 }),

  /** USD→INR rate in force when this bill was processed, so historical
      rupee figures never shift when the configured rate changes. */
  fxRateUsdInr: numeric('fx_rate_usd_inr', { mode: 'number', precision: 10, scale: 4 }),

  schemaVersion: integer('schema_version').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [
  check('bills_type_check', sql`${t.billType} IN ('MAINTENANCE','FUEL','INSURANCE','TYRE','TOLL','ACCIDENT_REPAIR','BATTERY_REPLACEMENT','AMC_CONTRACT','OTHER')`),
  check('bills_status_check', sql`${t.ocrStatus} IN ('DRAFT','UPLOADED','PROCESSING','OCR_COMPLETED','VERIFIED','FAILED')`),
  index('bills_updated_at_idx').on(t.updatedAt.desc()),
  index('bills_created_at_idx').on(t.createdAt.desc()),
  index('bills_status_updated_idx').on(t.ocrStatus, t.updatedAt.desc()),
  index('bills_vehicle_idx').on(t.vehicleId),
  index('bills_vendor_idx').on(t.vendorId),
  index('bills_dup_idx').on(t.invoiceNumber, t.vendorGstin),
  index('bills_vendor_trgm_idx').using('gin', sql`${t.vendorName} gin_trgm_ops`),
  index('bills_company_trgm_idx').using('gin', sql`${t.companyName} gin_trgm_ops`),
  index('bills_invoice_trgm_idx').using('gin', sql`${t.invoiceNumber} gin_trgm_ops`),
  index('bills_regno_trgm_idx').using('gin', sql`${t.registrationNumber} gin_trgm_ops`),
]);

// ─── bill_parts ─────────────────────────────────────────────────────────────

export const billParts = pgTable('bill_parts', {
  partId: text('part_id').primaryKey(),
  billId: text('bill_id').notNull().references(() => bills.billId, { onDelete: 'cascade' }),

  lineType: text('line_type').notNull(),

  name: text('name'),
  description: text('description'),

  quantity: numeric('quantity', { mode: 'number', precision: 12, scale: 3 }),
  rate: numeric('rate', { mode: 'number', precision: 14, scale: 2 }),
  amount: numeric('amount', { mode: 'number', precision: 14, scale: 2 }),

  taxPercentage: numeric('tax_percentage', { mode: 'number', precision: 6, scale: 3 }),
  taxAmount: numeric('tax_amount', { mode: 'number', precision: 14, scale: 2 }),

  partNumber: text('part_number'),
  hsnSacCode: text('hsn_sac_code'),

  manufacturer: text('manufacturer'),
  normalizedName: text('normalized_name'),

  confidenceScore: real('confidence_score'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [
  check('parts_line_type_check', sql`${t.lineType} IN ('PART','LABOUR')`),
  index('parts_bill_idx').on(t.billId),
  index('parts_created_idx').on(t.createdAt.desc()),
]);

// ─── users ──────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  userId: text('user_id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull(),
  apiKeyHash: text('api_key_hash').notNull(),
  apiKeyPrefix: text('api_key_prefix').notNull(),
  tokenBalance: numeric('token_balance', { mode: 'number', precision: 12, scale: 4 }).notNull(),
  totalTokensUsed: numeric('total_tokens_used', { mode: 'number', precision: 14, scale: 4 }).notNull(),
  totalOcrCount: integer('total_ocr_count').notNull(),
  totalCostUsd: numeric('total_cost_usd', { mode: 'number', precision: 18, scale: 10 }).notNull(),
  intakeEmail: text('intake_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [
  check('users_role_check', sql`${t.role} IN ('admin','user')`),
  check('users_status_check', sql`${t.status} IN ('active','blocked')`),
  uniqueIndex('users_email_idx').on(sql`lower(${t.email})`),
]);

// ─── api_keys ───────────────────────────────────────────────────────────────

export const apiKeys = pgTable('api_keys', {
  keyId: text('key_id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.userId, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('keys_hash_idx').on(t.keyHash),
  index('keys_user_idx').on(t.userId, t.createdAt.desc()),
]);

// ─── token_transactions ─────────────────────────────────────────────────────

export const tokenTransactions = pgTable('token_transactions', {
  txId: text('tx_id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.userId, { onDelete: 'restrict' }),
  type: text('type').notNull(),
  amount: numeric('amount', { mode: 'number', precision: 14, scale: 4 }).notNull(),
  balanceAfter: numeric('balance_after', { mode: 'number', precision: 12, scale: 4 }).notNull(),
  description: text('description').notNull(),
  referenceId: text('reference_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [
  check('tx_type_check', sql`${t.type} IN ('credit','debit')`),
  index('tx_user_created_idx').on(t.userId, t.createdAt.desc()),
]);

// ─── app_settings (single row) ───────────────────────────────────────────────

export const appSettings = pgTable('app_settings', {
  id: integer('id').primaryKey().default(1),
  pipelineMode: text('pipeline_mode').notNull(),
  extractionProvider: text('extraction_provider').notNull(),
  structuringProvider: text('structuring_provider').notNull(),
  structuringModel: text('structuring_model').notNull(),
  extractionModel: text('extraction_model'),
  singleProvider: text('single_provider'),
  singleModel: text('single_model'),
  emailIntakeEnabled: boolean('email_intake_enabled'),
  emailIntakeUser: text('email_intake_user'),
  emailIntakePollIntervalSec: integer('email_intake_poll_interval_sec'),
  emailIntakeAllowedSenders: text('email_intake_allowed_senders').array(),
  modelPricing: jsonb('model_pricing'),
  usdToInr: numeric('usd_to_inr', { mode: 'number', precision: 10, scale: 4 }),
  thinkingBudget: integer('thinking_budget'),
  mistralOcrPricePer1kPages: numeric('mistral_ocr_price_per_1k_pages', { mode: 'number', precision: 10, scale: 4 }),
}, (t) => [
  check('app_settings_singleton_check', sql`${t.id} = 1`),
]);

// ─── provider_credentials ────────────────────────────────────────────────────

export const providerCredentials = pgTable('provider_credentials', {
  provider: text('provider').primaryKey(),
  credentials: jsonb('credentials').notNull(),
});
