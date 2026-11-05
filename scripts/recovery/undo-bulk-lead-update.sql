-- Operator-only data repair. Requires explicit approval; never run as deployment DDL.
-- psql --no-psqlrc -v ON_ERROR_STOP=1 -v organization_id=... -v batch_id=... -v actor_id=... -f this-file
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
CREATE TEMP TABLE bulk_undo_candidates ON COMMIT DROP AS
SELECT a."entityId" AS id, a.id AS audit_id, a.changes,
       CASE WHEN a.changes ? 'leadStatus' THEN 'leadStatus' ELSE 'assignedUserId' END AS field
FROM "AuditEntry" a
WHERE a."organizationId" = :'organization_id' AND a."entityType" = 'Lead' AND a.action = 'UPDATE'
  AND a.changes->>'bulkRequestId' = :'batch_id'
  AND (a.changes ? 'leadStatus') <> (a.changes ? 'assignedUserId')
  AND a.changes->>'appliedUpdatedAt' IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "AuditEntry" duplicate WHERE duplicate.id <> a.id AND duplicate."organizationId" = a."organizationId" AND duplicate."entityType" = 'Lead' AND duplicate."entityId" = a."entityId" AND duplicate.changes->>'bulkRequestId' = :'batch_id');
-- Hold current memberships while restoring an earlier owner; departed owners are skipped.
SELECT id FROM "OrganizationMember" WHERE "organizationId" = :'organization_id'
  AND ("userId" = :'actor_id' OR "userId" IN (SELECT changes->field->>'old' FROM bulk_undo_candidates WHERE field = 'assignedUserId'))
  ORDER BY id FOR KEY SHARE;
-- A batch receipt remains a historical record. This repair writes its own audit entries.
WITH locked AS MATERIALIZED (
  SELECT l.id FROM "Lead" l JOIN bulk_undo_candidates c ON c.id = l.id
  WHERE l."organizationId" = :'organization_id' ORDER BY l.id FOR UPDATE OF l
), restored AS (
  UPDATE "Lead" l SET
    "leadStatus" = CASE WHEN c.field = 'leadStatus' THEN c.changes->c.field->>'old' ELSE l."leadStatus" END,
    "assignedUserId" = CASE WHEN c.field = 'assignedUserId' THEN c.changes->c.field->>'old' ELSE l."assignedUserId" END,
    "updatedAt" = greatest(clock_timestamp()::timestamp, l."updatedAt" + interval '1 millisecond')
  FROM bulk_undo_candidates c, locked
  WHERE l.id = c.id AND l.id = locked.id AND l."organizationId" = :'organization_id' AND l."deletedAt" IS NULL
    AND l."updatedAt" = (c.changes->>'appliedUpdatedAt')::timestamptz AT TIME ZONE 'UTC'
    AND (CASE WHEN c.field = 'leadStatus' THEN l."leadStatus" ELSE l."assignedUserId" END) IS NOT DISTINCT FROM c.changes->c.field->>'new'
    AND (c.field <> 'leadStatus' OR jsonb_typeof(c.changes->c.field->'old') = 'string')
    AND (c.field <> 'assignedUserId' OR c.changes->c.field->>'old' IS NULL OR EXISTS (SELECT 1 FROM "OrganizationMember" m WHERE m."organizationId" = :'organization_id' AND m."userId" = c.changes->c.field->>'old'))
    AND EXISTS (SELECT 1 FROM "OrganizationMember" actor WHERE actor."organizationId" = :'organization_id' AND actor."userId" = :'actor_id')
  RETURNING l.id, l."updatedAt", c.field, c.changes, c.audit_id
), logged AS (
  INSERT INTO "AuditEntry" (id, "userId", action, "entityType", "entityId", changes, "organizationId")
  SELECT gen_random_uuid()::text, :'actor_id', 'UPDATE', 'Lead', id,
    jsonb_build_object(field, jsonb_build_object('old', changes->field->'new', 'new', changes->field->'old'), 'undoBulkRequestId', :'batch_id', 'originalAuditId', audit_id, 'appliedUpdatedAt', to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    :'organization_id' FROM restored RETURNING id
)
SELECT count(*) AS restored_and_audited FROM logged;
COMMIT;
