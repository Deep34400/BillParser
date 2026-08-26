ALTER TABLE "bills" ALTER COLUMN "extraction_cost_usd" SET DATA TYPE numeric(18, 10);--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "structuring_cost_usd" SET DATA TYPE numeric(18, 10);--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "total_cost_usd" SET DATA TYPE numeric(18, 10);--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "total_input_cost_usd" SET DATA TYPE numeric(18, 10);--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "total_output_cost_usd" SET DATA TYPE numeric(18, 10);--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "input_rate_per_1m" SET DATA TYPE numeric(18, 10);--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "output_rate_per_1m" SET DATA TYPE numeric(18, 10);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "total_cost_usd" SET DATA TYPE numeric(18, 10);