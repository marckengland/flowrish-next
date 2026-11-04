-- Preserve the SQL-managed Library search index in the Prisma model too.
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_searchVector_idx" ON "KnowledgeChunk" USING GIN("searchVector");
