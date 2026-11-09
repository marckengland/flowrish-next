BEGIN;
CREATE TABLE "FollowUpComposeDraft" (
 "organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL, "followUpId" TEXT NOT NULL,
 "sourceVersion" TEXT NOT NULL CHECK ("sourceVersion" ~ '^[a-f0-9]{64}$'),
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN 1 AND 2000000000),
 "operationId" TEXT NOT NULL CHECK ("operationId" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
 "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
 "ciphertext" TEXT CHECK ("ciphertext" IS NULL OR octet_length("ciphertext") BETWEEN 60 AND 262144),
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FollowUpComposeDraft_pkey" PRIMARY KEY ("organizationId","userId","followUpId"),
 CONSTRAINT "FollowUpComposeDraft_member_fkey" FOREIGN KEY ("userId","organizationId") REFERENCES "OrganizationMember"("userId","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "FollowUpComposeDraft_followUp_fkey" FOREIGN KEY ("organizationId","followUpId") REFERENCES "FollowUpSuggestion"("organizationId",id) ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "FollowUpComposeDraft" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "FollowUpComposeDraft" FROM PUBLIC,anon,authenticated;
COMMIT;
