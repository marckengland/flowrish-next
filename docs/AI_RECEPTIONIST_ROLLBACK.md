# AI receptionist rollback

The migration adds two tables. Recovery keeps those tables and their call history, disables the receptionist, and reverts the application commit. It does not restore a database snapshot or remove customer records.

## Disable one workspace

Open **Settings → AI receptionist**, clear **Enable AI receptionist**, and save. If you cannot access the app, run the following parameterized statement through an authorized database session, supplying the affected organization's ID as `$1`:

```sql
UPDATE "ReceptionistConfig"
SET settings = jsonb_set(settings, '{enabled}', 'false'::jsonb),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "organizationId" = $1
  AND settings->>'enabled' = 'true';
```

Running it twice changes nothing on the second run. Other workspaces are outside its scope. If an incoming Twilio number has since been connected, restore its previous incoming handler before reverting application code. The previous handler must be recorded when connecting that number; no existing handler was changed by this release.

## Revert the application

Revert the merge commit containing the receptionist with `git revert -m 1 MERGE_COMMIT`, then deploy through the normal release process. The standalone task-test correction stays on main so the rollback does not restore the old failing assertion. Leave both additive tables in place. Do not edit an applied Prisma migration, drop call history, restore a full database snapshot, or force-push the deployment branch.

The code revert is checked against a disposable copy before merge. Disabling is immediate for subsequent webhook requests; a request already in progress can finish. The code rollback takes one normal deployment. Previously confirmed leads, activities, tasks, and audit entries remain and are not silently deleted.

## Tested database recovery

Run `npm run test:receptionist:integration` with Docker running and the existing `pgvector/pgvector:pg16` image available. The test never pulls an image, binds PostgreSQL only to localhost, uses synthetic data, and removes its disposable container afterward.

The integration test applies the complete migration history, checks Data API privileges, sends eight concurrent confirmations and verifies one callback, injects a failed task write and verifies transaction rollback, then disables the feature twice and verifies all call history and the control workspace remain unchanged.

Before the confirmed call, the synthetic database has one lead in the control workspace. After eight confirmations it has two leads total, one task, one call activity, and three audit entries. A failed callback leaves those counts unchanged and releases its claimed turn by rolling back the transaction. Disabling twice also preserves those counts and all saved call records.

## Inspect your installation

Check current row-level security, Data API grants, and authentication advisories in your own Supabase project. Historical maintainer inspection is not evidence about your installation. Keep credentials, customer counts, and operational results out of the public repository.
