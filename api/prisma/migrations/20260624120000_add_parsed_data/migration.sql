-- Store the full central-schema parsed_data JSON on each invoice.
ALTER TABLE "Invoice" ADD COLUMN "parsedData" JSONB;
