-- CreateEnum
CREATE TYPE "AssistanceMethod" AS ENUM ('BVN', 'NIN', 'BVN_AND_NIN', 'LADDER_ID');

-- AlterTable
ALTER TABLE "identity_records" ADD COLUMN     "email" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "phone_number" TEXT,
ADD COLUMN     "residential_address" TEXT,
ADD COLUMN     "state_of_origin" TEXT,
ADD COLUMN     "state_of_residence" TEXT,
ADD COLUMN     "town" TEXT;

-- CreateTable
CREATE TABLE "assistance_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "method" "AssistanceMethod" NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "user_id" TEXT,
    "liveness_verified_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistance_sessions_token_hash_key" ON "assistance_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "assistance_sessions_user_id_idx" ON "assistance_sessions"("user_id");

-- AddForeignKey
ALTER TABLE "assistance_sessions" ADD CONSTRAINT "assistance_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Same as every table: block Supabase's REST API (see enable_row_level_security).
ALTER TABLE "assistance_sessions" ENABLE ROW LEVEL SECURITY;
