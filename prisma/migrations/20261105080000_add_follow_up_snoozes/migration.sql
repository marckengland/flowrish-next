BEGIN;
CREATE UNIQUE INDEX "FollowUpSuggestion_organizationId_id_key" ON "FollowUpSuggestion"("organizationId",id);
CREATE TABLE "FollowUpSnooze" (
 "organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL, "followUpId" TEXT NOT NULL,
 "until" TIMESTAMP(3), "timeZone" TEXT NOT NULL CHECK (length("timeZone") BETWEEN 1 AND 100),
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK (revision>0), "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "FollowUpSnooze_pkey" PRIMARY KEY ("organizationId","userId","followUpId"),
 CONSTRAINT "FollowUpSnooze_member_fkey" FOREIGN KEY ("userId","organizationId") REFERENCES "OrganizationMember"("userId","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "FollowUpSnooze_followup_fkey" FOREIGN KEY ("organizationId","followUpId") REFERENCES "FollowUpSuggestion"("organizationId",id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FollowUpSnooze_organizationId_userId_until_idx" ON "FollowUpSnooze"("organizationId","userId","until");
ALTER TABLE "FollowUpSnooze" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "FollowUpSnooze" FROM PUBLIC,anon,authenticated;
COMMIT;
