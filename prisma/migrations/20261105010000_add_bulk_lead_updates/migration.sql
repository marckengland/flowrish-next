BEGIN;
CREATE TABLE "BulkLeadUpdate" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
 "change" JSONB NOT NULL CHECK (jsonb_typeof("change")='object' AND octet_length("change"::text)<=1024),
 "snapshots" JSONB NOT NULL CHECK (jsonb_typeof("snapshots")='array' AND jsonb_array_length("snapshots")<=100 AND octet_length("snapshots"::text)<=65536),
 "targetHash" TEXT CHECK ("targetHash" IS NULL OR "targetHash" ~ '^[a-f0-9]{64}$'),
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "appliedAt" TIMESTAMP(3),
 "updatedCount" INTEGER,
 "unchangedCount" INTEGER,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BulkLeadUpdate_member_fkey" FOREIGN KEY ("userId","organizationId") REFERENCES "OrganizationMember"("userId","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "BulkLeadUpdate_state_check" CHECK (("appliedAt" IS NULL AND "updatedCount" IS NULL AND "unchangedCount" IS NULL AND jsonb_array_length("snapshots") BETWEEN 1 AND 100) OR ("appliedAt" IS NOT NULL AND "updatedCount" IS NOT NULL AND "unchangedCount" IS NOT NULL AND "updatedCount">=0 AND "unchangedCount">=0 AND "updatedCount"+"unchangedCount" BETWEEN 1 AND 100 AND "snapshots"='[]'::jsonb))
);
CREATE INDEX "BulkLeadUpdate_organizationId_userId_appliedAt_expiresAt_idx" ON "BulkLeadUpdate"("organizationId","userId","appliedAt","expiresAt");
ALTER TABLE "BulkLeadUpdate" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "BulkLeadUpdate" FROM PUBLIC,anon,authenticated;
COMMIT;
