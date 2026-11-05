-- Operator-only repair: explicit approval for the exact business/review/acting user.
-- psql --no-psqlrc -v ON_ERROR_STOP=1 -v organization_id=... -v review_id=... -v actor_id=... -f this-file
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
SELECT set_config('flowrish.undo_org', :'organization_id', true), set_config('flowrish.undo_review', :'review_id', true), set_config('flowrish.undo_actor', :'actor_id', true);
DO $$
DECLARE
 org TEXT := current_setting('flowrish.undo_org'); actor TEXT := current_setting('flowrish.undo_actor');
 review "LeadMergeReview"%ROWTYPE; source "Lead"%ROWTYPE; kept "Lead"%ROWTYPE;
 tbl TEXT; pk TEXT; org_expr TEXT; joins TEXT; expected JSONB; actual JSONB; item JSONB;
 stamp TIMESTAMP(3); changed INTEGER; copied TEXT[];
BEGIN
 PERFORM id FROM "OrganizationMember" WHERE "organizationId"=org AND "userId"=actor FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'A current acting business member is required.'; END IF;
 SELECT * INTO review FROM "LeadMergeReview" WHERE id=current_setting('flowrish.undo_review') AND "organizationId"=org AND "appliedAt" IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Applied merge review not found.'; END IF;
 IF review.manifest ? 'undoneAt' THEN RETURN; END IF;
 PERFORM id FROM "Lead" WHERE "organizationId"=org AND id IN (review."primaryId",review."secondaryId") ORDER BY id FOR UPDATE;
 SELECT * INTO source FROM "Lead" WHERE id=review."secondaryId" AND "organizationId"=org;
 SELECT * INTO kept FROM "Lead" WHERE id=review."primaryId" AND "organizationId"=org;
 IF source.id IS NULL OR kept.id IS NULL OR source."mergedIntoId" IS DISTINCT FROM kept.id OR source."deletedAt" IS NULL OR kept."deletedAt" IS NOT NULL OR kept."mergedIntoId" IS NOT NULL THEN RAISE EXCEPTION 'Merge state changed; repair refused.'; END IF;
 IF source."assignedUserId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "OrganizationMember" WHERE "organizationId"=org AND "userId"=source."assignedUserId") THEN RAISE EXCEPTION 'The archived owner is no longer a business member; repair refused.'; END IF;
 IF source."assignedUserId" IS NOT NULL THEN
  PERFORM id FROM "OrganizationMember" WHERE "organizationId"=org AND "userId"=source."assignedUserId" FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The archived owner is no longer a business member; repair refused.'; END IF;
 END IF;
 SELECT jsonb_agg(jsonb_build_object('id',r.id,'hash',encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')) ORDER BY r.id) INTO actual FROM "Lead" r WHERE r."organizationId"=org AND r.id IN (review."primaryId",review."secondaryId");
 IF actual IS DISTINCT FROM review.manifest->'leads' THEN RAISE EXCEPTION 'A lead changed after merge; repair refused.'; END IF;
 FOREACH tbl IN ARRAY ARRAY['Activity','Task','StageTransition','ScoreHistory','LeadContact','CadenceEnrollment','FollowUpSuggestion','ReceptionistCall','WaitlistCrmHandoff','CallbackCrmHandoff'] LOOP
  pk := CASE tbl WHEN 'LeadContact' THEN 'contactId' WHEN 'WaitlistCrmHandoff' THEN 'waitlistId' WHEN 'CallbackCrmHandoff' THEN 'callbackId' ELSE 'id' END;
  joins := CASE WHEN tbl='LeadContact' THEN 'JOIN "Contact" c ON c.id=r."contactId"' ELSE '' END;
  org_expr := CASE WHEN tbl='LeadContact' THEN 'c."organizationId"' ELSE 'r."organizationId"' END;
  EXECUTE format('SELECT r.%I FROM %I r WHERE r."leadId" IN ($1,$2) ORDER BY r."leadId",r.%I FOR UPDATE OF r',pk,tbl,pk) USING review."primaryId",review."secondaryId";
  EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''id'',r.%I,''leadId'',r."leadId",''organizationId'',%s,''hash'',encode(sha256(convert_to(to_jsonb(r)::text,''UTF8'')),''hex'')) ORDER BY r."leadId",r.%I),''[]''::jsonb) FROM %I r %s WHERE r."leadId" IN ($1,$2)',pk,org_expr,pk,tbl,joins) INTO actual USING review."primaryId",review."secondaryId";
  expected := review.manifest->'related'->tbl;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Linked work changed after merge; repair refused.'; END IF;
 END LOOP;
 stamp := greatest(clock_timestamp()::timestamp,source."updatedAt"+interval '1 millisecond',kept."updatedAt"+interval '1 millisecond');
 UPDATE "Lead" SET "mergedIntoId"=NULL,"deletedAt"=NULL,"updatedAt"=stamp WHERE id=source.id AND "organizationId"=org;
 FOR item IN SELECT value FROM jsonb_array_elements(review.manifest->'moved') LOOP
  tbl := item->>'table';
  IF tbl NOT IN ('Activity','Task','StageTransition','ScoreHistory') THEN RAISE EXCEPTION 'Unknown transfer manifest; repair refused.'; END IF;
  EXECUTE format('UPDATE %I SET "leadId"=$1%s WHERE id=$2 AND "leadId"=$3 AND "organizationId"=$4',tbl,CASE WHEN tbl='Task' THEN ',"updatedAt"=$5' ELSE '' END) USING source.id,item->>'id',kept.id,org,stamp;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'Transfer manifest changed; repair refused.'; END IF;
 END LOOP;
 SELECT coalesce(array_agg(value),'{}'::text[]) INTO copied FROM jsonb_array_elements_text(review.manifest->'copiedContacts');
 DELETE FROM "LeadContact" WHERE "leadId"=kept.id AND "contactId"=ANY(copied);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>cardinality(copied) THEN RAISE EXCEPTION 'Copied contact links changed; repair refused.'; END IF;
 UPDATE "Lead" SET "updatedAt"=stamp WHERE id=kept.id AND "organizationId"=org;
 INSERT INTO "AuditEntry"(id,"userId",action,"entityType","entityId",changes,"organizationId")
 SELECT gen_random_uuid()::text,actor,'UPDATE','Lead',id,jsonb_build_object('undoMergeReviewId',review.id,'restoredSecondaryId',source.id,'retainedId',kept.id),org FROM "Lead" WHERE id IN(source.id,kept.id) AND "organizationId"=org;
 UPDATE "LeadMergeReview" SET manifest=manifest||jsonb_build_object('undoneAt',to_char(stamp,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHERE id=review.id AND "organizationId"=org;
END $$;
COMMIT;
