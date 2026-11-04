CREATE TABLE "WaitlistPilotInvite" (
  "id" TEXT PRIMARY KEY,
  "waitlistId" TEXT NOT NULL UNIQUE,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "issueRequestId" TEXT NOT NULL UNIQUE,
  "generation" INTEGER NOT NULL DEFAULT 1 CHECK ("generation" > 0),
  "issuedById" TEXT NOT NULL,
  "issuedByOrganizationId" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "acceptedById" TEXT,
  "organizationId" TEXT UNIQUE,
  CONSTRAINT "WaitlistPilotInvite_waitlistId_fkey" FOREIGN KEY ("waitlistId") REFERENCES "Waitlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WaitlistPilotInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WaitlistPilotInvite_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "WaitlistPilotInvite_expiry_check" CHECK ("expiresAt" > "issuedAt"),
  CONSTRAINT "WaitlistPilotInvite_receipt_check" CHECK (("acceptedAt" IS NULL AND "acceptedById" IS NULL AND "organizationId" IS NULL) OR ("acceptedAt" IS NOT NULL AND "acceptedById" IS NOT NULL AND "organizationId" IS NOT NULL AND "revokedAt" IS NULL))
);
CREATE INDEX "WaitlistPilotInvite_email_idx" ON "WaitlistPilotInvite"("email");
ALTER TABLE "WaitlistPilotInvite" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WaitlistPilotInvite" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE "WaitlistPilotInvite" FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE "WaitlistPilotInvite" FROM authenticated; END IF;
END $$;
