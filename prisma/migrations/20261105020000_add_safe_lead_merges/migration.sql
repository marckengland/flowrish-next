BEGIN;
ALTER TABLE "Lead" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Lead"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_merge_archive_check" CHECK ("mergedIntoId" IS NULL OR ("mergedIntoId"<>id AND "deletedAt" IS NOT NULL));
CREATE INDEX "Lead_mergedIntoId_idx" ON "Lead"("mergedIntoId");
CREATE TABLE "LeadMergeReview" (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL,
 "primaryId" TEXT NOT NULL, "secondaryId" TEXT NOT NULL, fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 manifest JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(manifest)='object' AND octet_length(manifest::text)<=262144),
 result JSONB, "expiresAt" TIMESTAMP(3) NOT NULL, "appliedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LeadMergeReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "LeadMergeReview_distinct_check" CHECK ("primaryId"<>"secondaryId"),
 CONSTRAINT "LeadMergeReview_state_check" CHECK (("appliedAt" IS NULL AND result IS NULL AND manifest='{}'::jsonb) OR ("appliedAt" IS NOT NULL AND result IS NOT NULL AND jsonb_typeof(result)='object' AND manifest<>'{}'::jsonb))
);
CREATE INDEX "LeadMergeReview_organizationId_userId_appliedAt_expiresAt_idx" ON "LeadMergeReview"("organizationId","userId","appliedAt","expiresAt");
ALTER TABLE "LeadMergeReview" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "LeadMergeReview" FROM PUBLIC,anon,authenticated;
CREATE FUNCTION "guardMergedLeadLink"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destination TEXT;
BEGIN
 IF NEW."leadId" IS NULL THEN RETURN NEW; END IF;
 SELECT "mergedIntoId" INTO destination FROM "Lead" WHERE id=NEW."leadId" FOR KEY SHARE;
 IF destination IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='This lead has been merged. Refresh before attaching work.'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION "guardMergedLeadLink"() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION "guardLeadMergeArchive"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_org TEXT; target_deleted TIMESTAMP; target_merged TEXT;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD."mergedIntoId" IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Merged lead archives require an explicit recovery procedure.'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD."mergedIntoId" IS NOT NULL THEN
  IF NEW."mergedIntoId" IS NULL AND NEW."deletedAt" IS NULL THEN RETURN NEW; END IF;
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Merged lead archives require an explicit recovery procedure.'; END IF;
 END IF;
 IF NEW."mergedIntoId" IS NOT NULL THEN
  SELECT "organizationId","deletedAt","mergedIntoId" INTO target_org,target_deleted,target_merged FROM "Lead" WHERE id=NEW."mergedIntoId" FOR KEY SHARE;
  IF NOT FOUND OR NEW.id=NEW."mergedIntoId" OR target_org<>NEW."organizationId" OR target_deleted IS NOT NULL OR target_merged IS NOT NULL OR NEW."deletedAt" IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Choose an active retained lead in the same business.'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION "guardLeadMergeArchive"() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER "Lead_merge_archive_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Lead" FOR EACH ROW EXECUTE FUNCTION "guardLeadMergeArchive"();
CREATE TRIGGER "lead_merge_link_guard" BEFORE INSERT OR UPDATE ON "Activity" FOR EACH ROW EXECUTE FUNCTION "guardMergedLeadLink"();
CREATE TRIGGER "lead_merge_link_guard" BEFORE INSERT OR UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION "guardMergedLeadLink"();
CREATE TRIGGER "lead_merge_link_guard" BEFORE INSERT OR UPDATE ON "LeadContact" FOR EACH ROW EXECUTE FUNCTION "guardMergedLeadLink"();
CREATE TRIGGER "lead_merge_link_guard" BEFORE INSERT OR UPDATE ON "StageTransition" FOR EACH ROW EXECUTE FUNCTION "guardMergedLeadLink"();
CREATE TRIGGER "lead_merge_link_guard" BEFORE INSERT OR UPDATE ON "ScoreHistory" FOR EACH ROW EXECUTE FUNCTION "guardMergedLeadLink"();
CREATE TRIGGER "lead_merge_link_guard" BEFORE INSERT OR UPDATE ON "CadenceEnrollment" FOR EACH ROW EXECUTE FUNCTION "guardMergedLeadLink"();
CREATE TRIGGER "lead_merge_link_guard" BEFORE INSERT OR UPDATE ON "FollowUpSuggestion" FOR EACH ROW EXECUTE FUNCTION "guardMergedLeadLink"();
CREATE TRIGGER "lead_merge_link_guard" BEFORE INSERT OR UPDATE ON "ReceptionistCall" FOR EACH ROW EXECUTE FUNCTION "guardMergedLeadLink"();
CREATE TRIGGER "lead_merge_link_guard" BEFORE INSERT OR UPDATE ON "WaitlistCrmHandoff" FOR EACH ROW EXECUTE FUNCTION "guardMergedLeadLink"();
CREATE TRIGGER "lead_merge_link_guard" BEFORE INSERT OR UPDATE ON "CallbackCrmHandoff" FOR EACH ROW EXECUTE FUNCTION "guardMergedLeadLink"();
COMMIT;
