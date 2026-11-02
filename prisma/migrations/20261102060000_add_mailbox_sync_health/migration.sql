-- Health and lease metadata only; mailbox credentials and messages are unchanged.
ALTER TABLE "EmailAccount"
ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN "syncRequestedAt" TIMESTAMP(3),
ADD COLUMN "syncAttemptAt" TIMESTAMP(3),
ADD COLUMN "syncRunId" TEXT,
ADD COLUMN "syncError" TEXT;
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_syncStatus_check"
CHECK ("syncStatus" IN ('idle', 'queued', 'running', 'healthy', 'failed'));
