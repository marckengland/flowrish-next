-- Snapshot identifiers preserve handoff idempotency after source or CRM deletion.
CREATE TABLE "CallbackCrmHandoff" (
    "callbackId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallbackCrmHandoff_pkey" PRIMARY KEY ("callbackId")
);
CREATE INDEX "CallbackCrmHandoff_organizationId_taskId_idx" ON "CallbackCrmHandoff"("organizationId", "taskId");
ALTER TABLE "CallbackCrmHandoff" ADD CONSTRAINT "CallbackCrmHandoff_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallbackCrmHandoff" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CallbackCrmHandoff" FROM PUBLIC, anon, authenticated;
