-- Preserve the existing per-status uniqueness for live enrollments while
-- allowing a re-enrolled lead to reach the same terminal outcome again.
-- No rows are rewritten or removed.
DROP INDEX "CadenceEnrollment_cadenceId_leadId_status_key";
CREATE UNIQUE INDEX "CadenceEnrollment_live_cadenceId_leadId_status_key"
ON "CadenceEnrollment"("cadenceId", "leadId", "status")
WHERE "status" IN ('ACTIVE', 'PAUSED');
CREATE INDEX "CadenceEnrollment_cadenceId_leadId_status_idx"
ON "CadenceEnrollment"("cadenceId", "leadId", "status");
