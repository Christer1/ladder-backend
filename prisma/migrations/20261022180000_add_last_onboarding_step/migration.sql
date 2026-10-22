-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('CREDENTIALS', 'UPLOAD_ID', 'LIVENESS');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_onboarding_step" "OnboardingStep";

