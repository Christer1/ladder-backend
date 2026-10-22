-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VerificationType" ADD VALUE 'GOVERNMENT_ID';
ALTER TYPE "VerificationType" ADD VALUE 'LIVENESS';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "pin_failed_attempts",
DROP COLUMN "pin_hash",
DROP COLUMN "pin_locked_until";

-- AlterTable
ALTER TABLE "verifications" ADD COLUMN     "document_type" TEXT;

