-- CreateEnum
CREATE TYPE "AssistanceIssueReason" AS ENUM ('NOT_FOUND', 'INVALID', 'DOB_MISMATCH', 'DIFFERENT_PEOPLE', 'LADDER_ID_UNKNOWN', 'LADDER_ID_NOT_VERIFIED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');

-- CreateTable
CREATE TABLE "assistance_issues" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "method" "AssistanceMethod" NOT NULL,
    "failed_type" "VerificationType",
    "reason" "AssistanceIssueReason" NOT NULL,
    "masked_value" TEXT NOT NULL,
    "contact_phone" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistance_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "phone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "status" "DeliveryStatus" NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistance_issues_reference_key" ON "assistance_issues"("reference");

-- CreateIndex
CREATE INDEX "assistance_issues_contact_phone_idx" ON "assistance_issues"("contact_phone");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_provider_message_id_key" ON "whatsapp_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_phone_created_at_idx" ON "whatsapp_messages"("phone", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_issue_id_idx" ON "whatsapp_messages"("issue_id");

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "assistance_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Same as every table: block Supabase's REST API (see enable_row_level_security).
ALTER TABLE "assistance_issues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_messages" ENABLE ROW LEVEL SECURITY;
