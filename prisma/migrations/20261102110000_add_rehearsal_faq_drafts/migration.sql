-- Provenance stays separate from FAQ text and published business knowledge.
CREATE UNIQUE INDEX "ReceptionistRehearsal_id_organizationId_key" ON "ReceptionistRehearsal"("id", "organizationId");
CREATE TABLE "RehearsalFaqDraft" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "rehearsalId" TEXT NOT NULL,
  "messageIndex" INTEGER NOT NULL,
  "documentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RehearsalFaqDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RehearsalFaqDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RehearsalFaqDraft_rehearsalId_organizationId_fkey" FOREIGN KEY ("rehearsalId", "organizationId") REFERENCES "ReceptionistRehearsal"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RehearsalFaqDraft_documentId_organizationId_fkey" FOREIGN KEY ("documentId", "organizationId") REFERENCES "KnowledgeDocument"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RehearsalFaqDraft_messageIndex_check" CHECK ("messageIndex" BETWEEN 0 AND 28)
);
CREATE UNIQUE INDEX "RehearsalFaqDraft_organizationId_rehearsalId_messageIndex_key" ON "RehearsalFaqDraft"("organizationId", "rehearsalId", "messageIndex");
CREATE UNIQUE INDEX "RehearsalFaqDraft_documentId_organizationId_key" ON "RehearsalFaqDraft"("documentId", "organizationId");
ALTER TABLE "RehearsalFaqDraft" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "RehearsalFaqDraft" FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "RehearsalFaqDraft" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
