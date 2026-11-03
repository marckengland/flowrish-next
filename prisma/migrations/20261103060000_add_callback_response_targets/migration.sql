CREATE TABLE "CallbackResponsePolicy" (
    "organizationId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "handoffMinutes" INTEGER NOT NULL DEFAULT 60,
    "attemptMinutes" INTEGER NOT NULL DEFAULT 120,
    "backupUserId" TEXT,
    "hours" JSONB,
    "businessUpdatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3),
    CONSTRAINT "CallbackResponsePolicy_minutes" CHECK ("handoffMinutes" BETWEEN 5 AND 1440 AND "attemptMinutes" BETWEEN 5 AND 1440),
    CONSTRAINT "CallbackResponsePolicy_enabled" CHECK (NOT enabled OR ("backupUserId" IS NOT NULL AND hours IS NOT NULL AND "businessUpdatedAt" IS NOT NULL)),
    CONSTRAINT "CallbackResponsePolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "CallbackResponseTarget" (
    "organizationId" TEXT NOT NULL,
    "callbackId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "policyVersion" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallbackResponseTarget_pkey" PRIMARY KEY ("organizationId","callbackId","phase"),
    CONSTRAINT "CallbackResponseTarget_phase" CHECK ((phase='handoff' AND "taskId" IS NULL) OR (phase='attempt' AND "taskId" IS NOT NULL)),
    CONSTRAINT "CallbackResponseTarget_deadline" CHECK ("dueAt">"startedAt"),
    CONSTRAINT "CallbackResponseTarget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CallbackResponseTarget_organizationId_policyVersion_dueAt_idx" ON "CallbackResponseTarget"("organizationId","policyVersion","dueAt");
ALTER TABLE "CallbackResponsePolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallbackResponseTarget" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CallbackResponsePolicy", "CallbackResponseTarget" FROM PUBLIC, anon, authenticated;
ALTER TABLE "CallbackNotification" DROP CONSTRAINT "CallbackNotification_kind";
ALTER TABLE "CallbackNotification" ADD CONSTRAINT "CallbackNotification_kind" CHECK (
  (kind='new_callback' AND "taskId" IS NULL AND "dueDate" IS NULL)
  OR (kind='handoff_escalation' AND "taskId" IS NULL AND "dueDate" IS NOT NULL)
  OR (kind IN ('assigned','overdue','attempt_escalation') AND "taskId" IS NOT NULL AND "dueDate" IS NOT NULL)
);
