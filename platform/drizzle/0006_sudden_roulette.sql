ALTER TABLE "app_settings" ADD COLUMN "mistral_ocr_price_per_1k_pages" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "extraction_pages" integer;