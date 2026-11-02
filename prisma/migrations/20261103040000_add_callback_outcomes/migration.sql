CREATE TABLE "CallbackOutcomeEvent" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "callbackId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallbackOutcomeEvent_pkey" PRIMARY KEY ("organizationId","id"),
    CONSTRAINT "CallbackOutcomeEvent_values" CHECK ("sequence">0 AND "outcome" IN ('reached','no_answer','retry') AND "action" IN ('record','reschedule','close') AND char_length("notes")<=2000 AND "requestHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "CallbackOutcomeEvent_schedule" CHECK (("action"='reschedule' AND "assigneeId" IS NOT NULL AND "assigneeName" IS NOT NULL AND "dueDate" IS NOT NULL) OR ("action"<>'reschedule' AND "assigneeId" IS NULL AND "assigneeName" IS NULL AND "dueDate" IS NULL))
);
CREATE UNIQUE INDEX "CallbackOutcomeEvent_organizationId_callbackId_sequence_key" ON "CallbackOutcomeEvent"("organizationId", "callbackId", "sequence");
ALTER TABLE "CallbackOutcomeEvent" ADD CONSTRAINT "CallbackOutcomeEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallbackOutcomeEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CallbackOutcomeEvent" FROM PUBLIC, anon, authenticated;
