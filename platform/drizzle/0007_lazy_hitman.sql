ALTER TABLE "bills" DROP CONSTRAINT "bills_status_check";--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "fallback_chain" jsonb;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "review_codes" text[];--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "total_reconciliation" jsonb;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "fallback_attempts" integer;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "fallback_history" jsonb;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_status_check" CHECK ("bills"."ocr_status" IN ('DRAFT','UPLOADED','PROCESSING','OCR_COMPLETED','NEED_REVIEW','VERIFIED','FAILED'));