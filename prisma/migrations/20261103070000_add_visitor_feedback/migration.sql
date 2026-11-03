ALTER TABLE "WebsiteReceptionistConfig" ADD COLUMN "feedbackEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WebsiteReceptionistSession" ADD COLUMN "feedbackRequestId" TEXT;

CREATE TABLE "WebsiteReceptionistFeedback" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceSessionId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "siteOrigin" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "faqDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebsiteReceptionistFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebsiteReceptionistFeedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WebsiteReceptionistFeedback_question_check" CHECK (char_length("question") BETWEEN 1 AND 1000 AND octet_length("question") <= 2000),
  CONSTRAINT "WebsiteReceptionistFeedback_status_check" CHECK ("status" IN ('open', 'dismissed'))
);
CREATE UNIQUE INDEX "WebsiteReceptionistFeedback_organizationId_sourceSessionId__key" ON "WebsiteReceptionistFeedback"("organizationId", "sourceSessionId", "requestId");
CREATE INDEX "WebsiteReceptionistFeedback_organizationId_status_createdAt_idx" ON "WebsiteReceptionistFeedback"("organizationId", "status", "createdAt");
CREATE INDEX "WebsiteReceptionistFeedback_createdAt_idx" ON "WebsiteReceptionistFeedback"("createdAt");
ALTER TABLE "WebsiteReceptionistFeedback" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WebsiteReceptionistFeedback" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE "WebsiteReceptionistFeedback" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE "WebsiteReceptionistFeedback" FROM authenticated; END IF;
END $$;

CREATE TABLE "WebsiteReceptionistFeedbackUsage" (
  "organizationId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "reports" INTEGER NOT NULL DEFAULT 0 CHECK ("reports" BETWEEN 0 AND 50),
  CONSTRAINT "WebsiteReceptionistFeedbackUsage_pkey" PRIMARY KEY ("organizationId", "day"),
  CONSTRAINT "WebsiteReceptionistFeedbackUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WebsiteReceptionistFeedbackUsage_day_idx" ON "WebsiteReceptionistFeedbackUsage"("day");
ALTER TABLE "WebsiteReceptionistFeedbackUsage" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WebsiteReceptionistFeedbackUsage" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE "WebsiteReceptionistFeedbackUsage" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE "WebsiteReceptionistFeedbackUsage" FROM authenticated; END IF;
END $$;
