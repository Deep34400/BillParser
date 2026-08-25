ALTER TABLE "app_settings" ADD COLUMN "usd_to_inr" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "fx_rate_usd_inr" numeric(10, 4);