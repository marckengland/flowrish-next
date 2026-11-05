BEGIN;
-- Existing production mail is server-only; preserve that boundary on fresh installs too.
ALTER TABLE "EmailMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailMessage" ADD COLUMN "leadRouting" JSONB;
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_leadRouting_check" CHECK ("leadRouting" IS NULL OR COALESCE(jsonb_typeof("leadRouting")='object' AND "leadRouting"->>'state' IN ('PENDING','ROUTED','UNMATCHED','DISMISSED') AND octet_length("leadRouting"::text)<=8192,FALSE));
CREATE INDEX "EmailMessage_pending_match_idx" ON "EmailMessage"("organizationId","accountId","createdAt" DESC) WHERE "leadRouting"->>'state'='PENDING';
COMMIT;
