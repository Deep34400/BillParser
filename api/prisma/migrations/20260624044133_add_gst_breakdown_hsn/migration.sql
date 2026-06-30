-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "cgstAmount" DOUBLE PRECISION,
ADD COLUMN     "discountAmount" DOUBLE PRECISION,
ADD COLUMN     "igstAmount" DOUBLE PRECISION,
ADD COLUMN     "netAmount" DOUBLE PRECISION,
ADD COLUMN     "sgstAmount" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "LineItem" ADD COLUMN     "hsnSac" TEXT;
