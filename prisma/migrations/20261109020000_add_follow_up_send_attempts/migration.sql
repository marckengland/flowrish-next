CREATE TABLE "FollowUpSendAttempt" (
    "organizationId" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowUpSendAttempt_pkey" PRIMARY KEY ("organizationId", "followUpId"),
    CONSTRAINT "FollowUpSendAttempt_state_check" CHECK ("state" IN ('PREPARING', 'DISPATCHING', 'CONFIRMED', 'FAILED')),
    CONSTRAINT "FollowUpSendAttempt_operation_check" CHECK ("operationId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT "FollowUpSendAttempt_hash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "FollowUpSendAttempt_result_check" CHECK (("state" = 'CONFIRMED') = ("result" IS NOT NULL) AND ("result" IS NULL OR jsonb_typeof("result") = 'object')),
    CONSTRAINT "FollowUpSendAttempt_followUp_fkey" FOREIGN KEY ("organizationId", "followUpId") REFERENCES "FollowUpSuggestion" ("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "FollowUpSendAttempt" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "FollowUpSendAttempt" FROM PUBLIC, anon, authenticated;
