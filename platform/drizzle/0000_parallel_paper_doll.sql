CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"key_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"api_key" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"pipeline_mode" text NOT NULL,
	"extraction_provider" text NOT NULL,
	"structuring_provider" text NOT NULL,
	"structuring_model" text NOT NULL,
	"extraction_model" text,
	"single_provider" text,
	"single_model" text,
	"email_intake_enabled" boolean,
	"email_intake_user" text,
	"email_intake_poll_interval_sec" integer,
	"email_intake_allowed_senders" text[],
	"model_pricing" jsonb,
	CONSTRAINT "app_settings_singleton_check" CHECK ("app_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "bill_parts" (
	"part_id" text PRIMARY KEY NOT NULL,
	"bill_id" text NOT NULL,
	"line_type" text NOT NULL,
	"name" text,
	"description" text,
	"quantity" numeric(12, 3),
	"rate" numeric(14, 2),
	"amount" numeric(14, 2),
	"tax_percentage" numeric(6, 3),
	"tax_amount" numeric(14, 2),
	"part_number" text,
	"hsn_sac_code" text,
	"manufacturer" text,
	"normalized_name" text,
	"confidence_score" real,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "parts_line_type_check" CHECK ("bill_parts"."line_type" IN ('PART','LABOUR'))
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"bill_id" text PRIMARY KEY NOT NULL,
	"fleet_id" text,
	"vehicle_id" text,
	"bill_type" text NOT NULL,
	"bill_category" text,
	"vendor_name" text,
	"vendor_gstin" text,
	"vendor_id" text,
	"company_name" text,
	"gstin" text,
	"pan" text,
	"irn" text,
	"invoice_number" text,
	"invoice_date" text,
	"invoice_time" text,
	"subtotal_amount" numeric(14, 2),
	"parts_amount" numeric(14, 2),
	"labour_amount" numeric(14, 2),
	"parts_cgst_amount" numeric(14, 2),
	"parts_sgst_amount" numeric(14, 2),
	"parts_igst_amount" numeric(14, 2),
	"parts_cgst_rate" numeric(6, 3),
	"parts_sgst_rate" numeric(6, 3),
	"parts_igst_rate" numeric(6, 3),
	"labour_cgst_amount" numeric(14, 2),
	"labour_sgst_amount" numeric(14, 2),
	"labour_igst_amount" numeric(14, 2),
	"labour_cgst_rate" numeric(6, 3),
	"labour_sgst_rate" numeric(6, 3),
	"labour_igst_rate" numeric(6, 3),
	"total_tax_amount" numeric(14, 2),
	"grand_total_amount" numeric(14, 2),
	"deductibles" numeric(14, 2),
	"salvage" numeric(14, 2),
	"odometer_reading" integer,
	"registration_number" text,
	"chassis_number" text,
	"ocr_status" text NOT NULL,
	"processing_status" text,
	"confidence_score" real,
	"review_reasons" text[],
	"file_url" text,
	"storage_path" text,
	"raw_ocr_reference" text,
	"parsed_data" jsonb,
	"pipeline_mode" text,
	"extraction_cost_usd" numeric(12, 6),
	"structuring_cost_usd" numeric(12, 6),
	"total_cost_usd" numeric(12, 6),
	"extraction_tokens" integer,
	"extraction_input_tokens" integer,
	"extraction_output_tokens" integer,
	"structuring_tokens" integer,
	"structuring_input_tokens" integer,
	"structuring_output_tokens" integer,
	"total_tokens" integer,
	"total_input_tokens" integer,
	"total_output_tokens" integer,
	"total_thinking_tokens" integer,
	"total_input_cost_usd" numeric(12, 6),
	"total_output_cost_usd" numeric(12, 6),
	"extraction_provider" text,
	"structuring_provider" text,
	"extraction_model" text,
	"structuring_model" text,
	"extraction_latency_ms" integer,
	"structuring_latency_ms" integer,
	"total_latency_ms" integer,
	"schema_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bills_type_check" CHECK ("bills"."bill_type" IN ('MAINTENANCE','FUEL','INSURANCE','TYRE','TOLL','ACCIDENT_REPAIR','BATTERY_REPLACEMENT','AMC_CONTRACT','OTHER')),
	CONSTRAINT "bills_status_check" CHECK ("bills"."ocr_status" IN ('DRAFT','UPLOADED','PROCESSING','OCR_COMPLETED','VERIFIED','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"provider" text PRIMARY KEY NOT NULL,
	"credentials" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_transactions" (
	"tx_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"balance_after" numeric(12, 4) NOT NULL,
	"description" text NOT NULL,
	"reference_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tx_type_check" CHECK ("token_transactions"."type" IN ('credit','debit'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"api_key_prefix" text NOT NULL,
	"token_balance" numeric(12, 4) NOT NULL,
	"total_tokens_used" numeric(14, 4) NOT NULL,
	"total_ocr_count" integer NOT NULL,
	"total_cost_usd" numeric(12, 6) NOT NULL,
	"intake_email" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('admin','user')),
	CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('active','blocked'))
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"vendor_id" text PRIMARY KEY NOT NULL,
	"legal_name" text,
	"display_name" text,
	"gstin" text,
	"pan" text,
	"invoice_count" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"parser_name" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_parts" ADD CONSTRAINT "bill_parts_bill_id_bills_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("bill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_vendor_id_vendors_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("vendor_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_transactions" ADD CONSTRAINT "token_transactions_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "keys_user_idx" ON "api_keys" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "parts_bill_idx" ON "bill_parts" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "parts_created_idx" ON "bill_parts" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bills_updated_at_idx" ON "bills" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bills_created_at_idx" ON "bills" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bills_status_updated_idx" ON "bills" USING btree ("ocr_status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bills_vehicle_idx" ON "bills" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "bills_vendor_idx" ON "bills" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "bills_dup_idx" ON "bills" USING btree ("invoice_number","vendor_gstin");--> statement-breakpoint
CREATE INDEX "bills_vendor_trgm_idx" ON "bills" USING gin ("vendor_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bills_company_trgm_idx" ON "bills" USING gin ("company_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bills_invoice_trgm_idx" ON "bills" USING gin ("invoice_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bills_regno_trgm_idx" ON "bills" USING gin ("registration_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tx_user_created_idx" ON "token_transactions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "vendors_gstin_idx" ON "vendors" USING btree ("gstin");--> statement-breakpoint
CREATE INDEX "vendors_pan_idx" ON "vendors" USING btree ("pan");--> statement-breakpoint
CREATE INDEX "vendors_legalname_idx" ON "vendors" USING btree (lower("legal_name"));--> statement-breakpoint
CREATE INDEX "vendors_count_idx" ON "vendors" USING btree ("invoice_count" DESC NULLS LAST);