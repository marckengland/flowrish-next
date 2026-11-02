CREATE TABLE "KnowledgeDocument" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "title" TEXT NOT NULL,
 "category" TEXT NOT NULL CHECK ("category" IN ('PRICING','SERVICES','FAQ','GENERAL')),
 "contentText" TEXT NOT NULL CHECK (length("contentText") BETWEEN 1 AND 100000),
 "sourceName" TEXT,
 "sourceMime" TEXT,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "publishedTitle" TEXT,
 "publishedCategory" TEXT,
 "publishedText" TEXT,
 "publishedRevision" INTEGER,
 "publishedAt" TIMESTAMP(3),
 "publishedById" TEXT,
 "receptionistApprovedRevision" INTEGER,
 "receptionistApprovedAt" TIMESTAMP(3),
 "receptionistApprovedById" TEXT,
 "archivedAt" TIMESTAMP(3),
 "createdById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "KnowledgeDocument_id_organizationId_key" ON "KnowledgeDocument"("id","organizationId");
CREATE INDEX "KnowledgeDocument_organizationId_archivedAt_createdAt_idx" ON "KnowledgeDocument"("organizationId","archivedAt","createdAt");
CREATE TABLE "KnowledgeChunk" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "documentId" TEXT NOT NULL,
 "revision" INTEGER NOT NULL,
 "ordinal" INTEGER NOT NULL,
 "content" TEXT NOT NULL CHECK (length("content") BETWEEN 1 AND 1200),
 "title" TEXT NOT NULL,
 "category" TEXT NOT NULL,
 "searchVector" tsvector NOT NULL DEFAULT ''::tsvector,
 CONSTRAINT "KnowledgeChunk_documentId_organizationId_fkey" FOREIGN KEY ("documentId","organizationId") REFERENCES "KnowledgeDocument"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "KnowledgeChunk_documentId_revision_ordinal_key" ON "KnowledgeChunk"("documentId","revision","ordinal");
CREATE INDEX "KnowledgeChunk_organizationId_documentId_revision_idx" ON "KnowledgeChunk"("organizationId","documentId","revision");
CREATE INDEX "KnowledgeChunk_searchVector_idx" ON "KnowledgeChunk" USING GIN("searchVector");
CREATE FUNCTION knowledge_chunk_search_vector() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 NEW."searchVector" := setweight(to_tsvector('simple',coalesce(NEW."title",'')),'A') ||
 setweight(to_tsvector('simple',coalesce(NEW."category",'') || ' ' || CASE NEW."category"
 WHEN 'PRICING' THEN 'price prices pricing cost costs much fee fees rate rates quote quotation'
 WHEN 'SERVICES' THEN 'service services offer offers offering offerings help business'
 WHEN 'FAQ' THEN 'faq question questions common frequently answers'
 ELSE '' END),'B') || setweight(to_tsvector('simple',NEW."content"),'C');
 RETURN NEW;
END $$;
CREATE TRIGGER "KnowledgeChunk_search_vector" BEFORE INSERT OR UPDATE OF "title","category","content" ON "KnowledgeChunk" FOR EACH ROW EXECUTE FUNCTION knowledge_chunk_search_vector();
ALTER TABLE "KnowledgeDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeChunk" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE api_role TEXT;
BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON TABLE "KnowledgeDocument", "KnowledgeChunk" FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
