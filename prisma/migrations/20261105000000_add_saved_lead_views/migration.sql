BEGIN;
CREATE TABLE "SavedLeadView" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "filters" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedLeadView_member_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "OrganizationMember"("userId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SavedLeadView_name_check" CHECK (char_length("name") BETWEEN 1 AND 80 AND "name" = btrim("name") AND "name" !~ '[[:cntrl:]]'),
  CONSTRAINT "SavedLeadView_filters_check" CHECK (jsonb_typeof("filters") = 'object' AND octet_length("filters"::text) <= 4096),
  CONSTRAINT "SavedLeadView_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "SavedLeadView_organizationId_userId_name_key" ON "SavedLeadView" ("organizationId", "userId", "name");
ALTER TABLE "SavedLeadView" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "SavedLeadView" FROM PUBLIC, anon, authenticated;
COMMIT;
