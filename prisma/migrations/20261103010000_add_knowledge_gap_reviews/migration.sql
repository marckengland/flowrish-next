-- Manual inbox review metadata, separate from source reports and published FAQs.
CREATE TABLE "KnowledgeGapReview" (
  "organizationId" TEXT NOT NULL,
  "questionKey" TEXT NOT NULL,
  "resolvedFingerprint" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeGapReview_pkey" PRIMARY KEY ("organizationId", "questionKey"),
  CONSTRAINT "KnowledgeGapReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeGapReview_state_check" CHECK (
    "questionKey" ~ '^[a-f0-9]{64}$' AND length("notes") <= 2000 AND (
      ("resolvedFingerprint" IS NULL AND "resolvedAt" IS NULL AND "resolvedById" IS NULL) OR
      ("resolvedFingerprint" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL AND "resolvedFingerprint" ~ '^[a-f0-9]{64}$')
    )
  )
);
ALTER TABLE "KnowledgeGapReview" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "KnowledgeGapReview" FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "KnowledgeGapReview" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
