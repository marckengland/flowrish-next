BEGIN;
CREATE TABLE "FollowUpTaskBatch" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL,
 "plan" JSONB NOT NULL,
 "progress" JSONB NOT NULL,
 "nextIndex" INTEGER NOT NULL DEFAULT 0,
 "activeIndex" INTEGER,
 "stopped" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FollowUpTaskBatch_member_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "OrganizationMember"("userId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "FollowUpTaskBatch_kind_check" CHECK ("kind" IN ('COMPLETE', 'RESCHEDULE')),
 CONSTRAINT "FollowUpTaskBatch_hash_check" CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "FollowUpTaskBatch_plan_check" CHECK (jsonb_typeof("plan") = 'array' AND jsonb_array_length("plan") BETWEEN 1 AND 20 AND octet_length("plan"::text) <= 32768),
 CONSTRAINT "FollowUpTaskBatch_progress_check" CHECK (jsonb_typeof("progress") = 'array' AND jsonb_array_length("progress") = jsonb_array_length("plan") AND "progress" <@ '["NOT_ATTEMPTED","UNCERTAIN","FAILED","CONFIRMED"]'::jsonb),
 CONSTRAINT "FollowUpTaskBatch_index_check" CHECK ("nextIndex" BETWEEN 0 AND jsonb_array_length("plan") AND ("activeIndex" IS NULL OR "activeIndex" = "nextIndex" AND "activeIndex" < jsonb_array_length("plan")))
);
CREATE INDEX "FollowUpTaskBatch_userId_organizationId_createdAt_id_idx" ON "FollowUpTaskBatch" ("userId", "organizationId", "createdAt" DESC, "id");
ALTER TABLE "FollowUpTaskBatch" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "FollowUpTaskBatch" FROM PUBLIC, anon, authenticated;
COMMIT;
