BEGIN;
CREATE TABLE "EmailNotificationRead" (
 "organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL, key TEXT NOT NULL CHECK (key ~ '^[a-f0-9]{64}$'), "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EmailNotificationRead_pkey" PRIMARY KEY ("organizationId","userId",key),
 CONSTRAINT "EmailNotificationRead_member_fkey" FOREIGN KEY ("userId","organizationId") REFERENCES "OrganizationMember"("userId","organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "EmailNotificationRead" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "EmailNotificationRead" FROM PUBLIC,anon,authenticated;
COMMIT;
