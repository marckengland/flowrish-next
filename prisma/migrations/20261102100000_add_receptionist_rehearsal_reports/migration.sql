-- Browser rehearsals are admin review records, separate from customer calls.
CREATE TABLE "ReceptionistRehearsal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "verdict" TEXT NOT NULL DEFAULT 'unreviewed',
  "notes" TEXT NOT NULL DEFAULT '',
  "unansweredMessageIndexes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReceptionistRehearsal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReceptionistRehearsal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReceptionistRehearsal_review_check" CHECK (
    "verdict" IN ('unreviewed', 'passed', 'needs_work') AND
    length("title") BETWEEN 1 AND 120 AND length("notes") <= 2000 AND
    cardinality("unansweredMessageIndexes") <= 14 AND
    jsonb_typeof("snapshot") = 'object'
  )
);
CREATE UNIQUE INDEX "ReceptionistRehearsal_organizationId_clientId_key" ON "ReceptionistRehearsal"("organizationId", "clientId");
CREATE INDEX "ReceptionistRehearsal_organizationId_createdAt_id_idx" ON "ReceptionistRehearsal"("organizationId", "createdAt", "id");

ALTER TABLE "ReceptionistRehearsal" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ReceptionistRehearsal" FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "ReceptionistRehearsal" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
