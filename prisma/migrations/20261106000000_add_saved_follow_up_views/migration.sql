BEGIN;
CREATE TABLE "SavedFollowUpView" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "settings" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedFollowUpView_member_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "OrganizationMember"("userId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SavedFollowUpView_name_check" CHECK (char_length("name") BETWEEN 1 AND 80 AND "name" = btrim("name") AND "name" !~ '[[:cntrl:]]'),
  CONSTRAINT "SavedFollowUpView_settings_check" CHECK (jsonb_typeof("settings") = 'object' AND octet_length("settings"::text) <= 4096),
  CONSTRAINT "SavedFollowUpView_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "SavedFollowUpView_organizationId_userId_name_key" ON "SavedFollowUpView" ("organizationId", "userId", "name");
ALTER TABLE "SavedFollowUpView" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "SavedFollowUpView" FROM PUBLIC, anon, authenticated;
COMMIT;
