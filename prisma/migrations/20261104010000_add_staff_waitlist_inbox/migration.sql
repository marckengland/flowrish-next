ALTER TABLE "Waitlist"
  ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" TEXT,
  ADD CONSTRAINT "Waitlist_reviewStatus_check" CHECK ("reviewStatus" IN ('new','reviewed','contacted')),
  ADD CONSTRAINT "Waitlist_reviewVersion_check" CHECK ("reviewVersion" >= 0);
CREATE INDEX "Waitlist_reviewStatus_createdAt_id_idx" ON "Waitlist"("reviewStatus", "createdAt", "id");

CREATE TABLE "WaitlistStaffAccess" (
  "membershipId" TEXT PRIMARY KEY,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaitlistStaffAccess_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WaitlistCrmHandoff" (
  "waitlistId" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdLead" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaitlistCrmHandoff_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "WaitlistCrmHandoff_organizationId_leadId_idx" ON "WaitlistCrmHandoff"("organizationId", "leadId");

ALTER TABLE "Waitlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistStaffAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistCrmHandoff" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Waitlist", "WaitlistStaffAccess", "WaitlistCrmHandoff" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE "Waitlist", "WaitlistStaffAccess", "WaitlistCrmHandoff" FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE "Waitlist", "WaitlistStaffAccess", "WaitlistCrmHandoff" FROM authenticated;
  END IF;
END $$;
