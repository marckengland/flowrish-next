BEGIN;
CREATE TABLE "ContactSuppression" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "blocked" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "reason" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactSuppression_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContactSuppression_email_check" CHECK ("email"=lower(btrim("email")) AND length("email") BETWEEN 3 AND 320 AND position('@' in "email")>1),
  CONSTRAINT "ContactSuppression_revision_check" CHECK ("revision">0),
  CONSTRAINT "ContactSuppression_reason_check" CHECK (length(btrim("reason")) BETWEEN 3 AND 1000),
  CONSTRAINT "ContactSuppression_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContactSuppression_organizationId_email_key" ON "ContactSuppression"("organizationId","email");
ALTER TABLE "ContactSuppression" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ContactSuppression" FROM PUBLIC, anon, authenticated;
COMMIT;
