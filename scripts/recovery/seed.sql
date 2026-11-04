-- Invented records only. This fixture is never applied to a hosted database.
INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES
 ('org-a','Synthetic workshop','synthetic-workshop','2026-01-01'),
 ('org-b','Synthetic clinic','synthetic-clinic','2026-01-01');
INSERT INTO "User" (id,"authId",email,name,"updatedAt") VALUES
 ('user-a','synthetic-auth-a','a@example.invalid','Synthetic A','2026-01-01'),
 ('user-b','synthetic-auth-b','b@example.invalid','Synthetic B','2026-01-01');
INSERT INTO "OrganizationMember" (id,"userId","organizationId") VALUES ('member-a','user-a','org-a'),('member-b','user-b','org-b');
INSERT INTO "Pipeline" (id,name,"organizationId","updatedAt") VALUES ('pipeline-a','Sales','org-a','2026-01-01'),('pipeline-b','Bookings','org-b','2026-01-01');
INSERT INTO "Stage" (id,name,"order","pipelineId") VALUES ('stage-a','New',0,'pipeline-a'),('stage-b','New',0,'pipeline-b');
INSERT INTO "Company" (id,name,"organizationId","updatedAt") VALUES ('company-a','Example A','org-a','2026-01-01'),('company-b','Example B','org-b','2026-01-01');
INSERT INTO "Contact" (id,"firstName","lastName","companyId","organizationId","updatedAt") VALUES ('contact-a','Synthetic','A','company-a','org-a','2026-01-01'),('contact-b','Synthetic','B','company-b','org-b','2026-01-01');
INSERT INTO "Lead" (id,"firstName","lastName","stageId","companyId","assignedUserId","dealValue","organizationId","updatedAt") VALUES ('lead-a','Synthetic','A','stage-a','company-a','user-a',250,'org-a','2026-01-01'),('lead-b','Synthetic','B','stage-b','company-b','user-b',500,'org-b','2026-01-01');
INSERT INTO "LeadContact" ("leadId","contactId") VALUES ('lead-a','contact-a'),('lead-b','contact-b');
INSERT INTO "Task" (id,title,"dueDate","leadId","assigneeId","organizationId","updatedAt") VALUES ('task-a','Synthetic callback','2027-01-01','lead-a','user-a','org-a','2026-01-01'),('task-b','Synthetic callback','2027-01-01','lead-b','user-b','org-b','2026-01-01');
INSERT INTO "KnowledgeDocument" (id,"organizationId",title,category,"contentText",revision,"publishedTitle","publishedCategory","publishedText","publishedRevision","publishedAt","publishedById","receptionistApprovedRevision","receptionistApprovedAt","receptionistApprovedById","createdById","updatedAt") VALUES
 ('document-a','org-a','Draft fees','PRICING','Unpublished fee is 999.',3,'Workshop fees','PRICING','Synthetic service fee is 250.',2,'2026-01-01','user-a',2,'2026-01-01','user-a','user-a','2026-01-01'),
 ('document-b','org-b','Internal clinic guide','SERVICES','Private clinic policy.',2,'Internal clinic guide','SERVICES','Private clinic policy.',2,'2026-01-01','user-b',NULL,NULL,NULL,'user-b','2026-01-01'),
 ('document-draft','org-a','Unpublished FAQ','FAQ','Do not disclose this draft.',1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'user-a','2026-01-01');
INSERT INTO "KnowledgeChunk" (id,"organizationId","documentId",revision,ordinal,content,title,category) VALUES
 ('chunk-a','org-a','document-a',2,0,'Synthetic service fee is 250.','Workshop fees','PRICING'),
 ('chunk-b','org-b','document-b',2,0,'Private clinic policy.','Internal clinic guide','SERVICES');
INSERT INTO "WebsiteReceptionistConfig" ("organizationId","publicId",enabled,"updatedAt") VALUES ('org-a','synthetic-public-a',false,'2026-01-01'),('org-b','synthetic-public-b',false,'2026-01-01');

-- Model the read-only live catalog baseline, not an application authorization test.
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON "Lead", "Task" TO anon, authenticated;
