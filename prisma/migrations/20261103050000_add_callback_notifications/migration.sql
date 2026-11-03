CREATE TABLE "CallbackNotification" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "callbackId" TEXT NOT NULL,
    "taskId" TEXT,
    "entityVersion" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "CallbackNotification_pkey" PRIMARY KEY ("organizationId", "userId", "key"),
    CONSTRAINT "CallbackNotification_key" CHECK ("key" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "CallbackNotification_kind" CHECK (("kind"='new_callback' AND "taskId" IS NULL AND "dueDate" IS NULL) OR ("kind" IN ('assigned','overdue') AND "taskId" IS NOT NULL AND "dueDate" IS NOT NULL))
);
CREATE INDEX "CallbackNotification_organizationId_userId_createdAt_key_idx" ON "CallbackNotification"("organizationId", "userId", "createdAt", "key");
ALTER TABLE "CallbackNotification" ADD CONSTRAINT "CallbackNotification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallbackNotification" ADD CONSTRAINT "CallbackNotification_userId_organizationId_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "OrganizationMember"("userId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallbackNotification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CallbackNotification" FROM PUBLIC, anon, authenticated;
