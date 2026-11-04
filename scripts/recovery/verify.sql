DO $$ BEGIN
 IF (SELECT count(*) FROM "Task" t JOIN "Lead" l ON l.id=t."leadId" AND l."organizationId"=t."organizationId" JOIN "Stage" s ON s.id=l."stageId" JOIN "Pipeline" p ON p.id=s."pipelineId" AND p."organizationId"=l."organizationId" JOIN "Company" c ON c.id=l."companyId" AND c."organizationId"=l."organizationId" JOIN "User" u ON u.id=t."assigneeId" JOIN "OrganizationMember" m ON m."userId"=u.id AND m."organizationId"=t."organizationId" JOIN "LeadContact" lc ON lc."leadId"=l.id JOIN "Contact" ct ON ct.id=lc."contactId" AND ct."organizationId"=l."organizationId") <> 2 THEN RAISE EXCEPTION 'CRM relationships differ'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "KnowledgeDocument" WHERE id='document-a' AND revision=3 AND "contentText"='Unpublished fee is 999.' AND "publishedRevision"=2 AND "publishedText"='Synthetic service fee is 250.' AND "receptionistApprovedRevision"=2) THEN RAISE EXCEPTION 'Knowledge snapshots differ'; END IF;
 IF (SELECT count(*) FROM "KnowledgeDocument" d JOIN "KnowledgeChunk" c ON c."documentId"=d.id AND c."organizationId"=d."organizationId" AND c.revision=d."publishedRevision" WHERE d."receptionistApprovedRevision"=d."publishedRevision" AND d."archivedAt" IS NULL) <> 1 THEN RAISE EXCEPTION 'Knowledge approval differs'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "KnowledgeDocument" WHERE id='document-draft' AND "publishedRevision" IS NULL) OR NOT EXISTS (SELECT 1 FROM "KnowledgeDocument" WHERE id='document-b' AND "receptionistApprovedRevision" IS NULL) THEN RAISE EXCEPTION 'Private knowledge differs'; END IF;
 IF (SELECT count(*) FROM "WebsiteReceptionistConfig" WHERE NOT enabled) <> 2 THEN RAISE EXCEPTION 'Widget state differs'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='KnowledgeChunk_searchVector_idx' AND indexdef LIKE '%USING gin%') THEN RAISE EXCEPTION 'FTS index missing'; END IF;
 IF (SELECT count(*) FROM "KnowledgeChunk" WHERE "searchVector" @@ plainto_tsquery('simple','250')) <> 1 THEN RAISE EXCEPTION 'FTS data differs'; END IF;
 BEGIN
  INSERT INTO "KnowledgeChunk" (id,"organizationId","documentId",revision,ordinal,content,title,category) VALUES ('bad','org-a','document-b',2,99,'Invalid','Invalid','GENERAL');
  RAISE EXCEPTION 'Cross-tenant chunk accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO "Task" (id,title,"dueDate","leadId","assigneeId","organizationId","updatedAt") VALUES ('bad','Orphan','2027-01-01','missing','user-a','org-a','2026-01-01');
  RAISE EXCEPTION 'Orphan task accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
BEGIN;
UPDATE "KnowledgeChunk" SET content='Synthetic trigger quasar check.' WHERE id='chunk-a';
DO $$ BEGIN
 IF (SELECT count(*) FROM "KnowledgeChunk" WHERE "searchVector" @@ plainto_tsquery('simple','quasar')) <> 1 THEN RAISE EXCEPTION 'FTS update trigger failed'; END IF;
END $$;
ROLLBACK;
SET ROLE anon;
DO $$ BEGIN
 IF (SELECT count(*) FROM "Lead") <> 0 OR (SELECT count(*) FROM "Task") <> 0 THEN RAISE EXCEPTION 'Anonymous RLS failed'; END IF;
 BEGIN PERFORM 1 FROM "KnowledgeDocument"; RAISE EXCEPTION 'Anonymous knowledge readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM "KnowledgeChunk"; RAISE EXCEPTION 'Anonymous chunks readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM "Lead") <> 0 OR (SELECT count(*) FROM "Task") <> 0 THEN RAISE EXCEPTION 'Authenticated RLS failed'; END IF;
 BEGIN PERFORM 1 FROM "KnowledgeDocument"; RAISE EXCEPTION 'Authenticated knowledge readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM "KnowledgeChunk"; RAISE EXCEPTION 'Authenticated chunks readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
