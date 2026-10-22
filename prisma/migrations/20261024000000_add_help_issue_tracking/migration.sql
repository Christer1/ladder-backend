-- CreateEnum
CREATE TYPE "AssistanceIssueStatus" AS ENUM ('OPEN', 'IN_CHAT', 'NEEDS_ATTENTION', 'ESCALATED', 'RESOLVED');

-- AlterTable
ALTER TABLE "assistance_issues" ADD COLUMN     "attempt_fingerprint" TEXT,
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "id_fingerprint" TEXT,
ADD COLUMN     "last_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "open_fingerprint" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "resolved_by" TEXT,
ADD COLUMN     "status" "AssistanceIssueStatus" NOT NULL DEFAULT 'OPEN';

-- Issues logged before fingerprints existed: a value no attempt can produce, so they are never
-- reused or auto-resolved. Their open_fingerprint stays null.
UPDATE "assistance_issues"
SET "attempt_fingerprint" = 'legacy:' || "id",
    "id_fingerprint" = 'legacy:' || "id",
    "last_attempt_at" = "created_at",
    "status" = CASE WHEN "contact_phone" IS NULL THEN 'OPEN'::"AssistanceIssueStatus" ELSE 'IN_CHAT'::"AssistanceIssueStatus" END;

ALTER TABLE "assistance_issues" ALTER COLUMN "attempt_fingerprint" SET NOT NULL,
ALTER COLUMN "id_fingerprint" SET NOT NULL;

-- CreateTable
CREATE TABLE "assistance_issue_notes" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistance_issue_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistance_issue_notes_issue_id_idx" ON "assistance_issue_notes"("issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "assistance_issues_open_fingerprint_key" ON "assistance_issues"("open_fingerprint");

-- CreateIndex
CREATE INDEX "assistance_issues_id_fingerprint_idx" ON "assistance_issues"("id_fingerprint");

-- CreateIndex
CREATE INDEX "assistance_issues_status_updated_at_idx" ON "assistance_issues"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "assistance_issue_notes" ADD CONSTRAINT "assistance_issue_notes_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "assistance_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same as every table: block Supabase's REST API (see enable_row_level_security).
ALTER TABLE "assistance_issue_notes" ENABLE ROW LEVEL SECURITY;
