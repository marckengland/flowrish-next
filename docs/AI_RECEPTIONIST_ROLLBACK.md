# AI receptionist rollback

The migration adds two tables. Recovery keeps those tables and their call history, disables the receptionist, and reverts the application commit. It does not restore a database snapshot or remove customer records.

## Before deployment

Observed on 2026-11-02 in Supabase project `ilkfauwpjyrqcowlzwtz`:

| Item | Before |
|---|---:|
| Organizations | 2 |
| Leads | 10 |
| Tasks | 7 |
| Activities | 9 |
| Voice configurations | 0 |
| Receptionist tables | 0 |

Prisma has applied all 13 earlier migrations. Migration `20261102020000_add_ai_receptionist` is not applied. The application base commit is `3095401`.

No Twilio credentials or incoming-number routing existed to overwrite. Vercel CLI authentication was expired when checked. This change does not modify existing phone routes.

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

Revert the merge commit containing the receptionist with `git revert -m 1 MERGE_COMMIT`, then deploy through the normal release process. Leave both additive tables in place. Do not edit an applied Prisma migration, drop call history, restore a full database snapshot, or force-push the deployment branch.

The code revert is checked against a disposable copy before merge. Disabling is immediate for subsequent webhook requests; a request already in progress can finish. The code rollback takes one normal deployment. Previously confirmed leads, activities, tasks, and audit entries remain and are not silently deleted.

## Deployment verification

Migration `20261102020000_add_ai_receptionist` was applied through Prisma on 2026-11-02. The post-change counts remain 2 organizations, 10 leads, 7 tasks, and 9 activities. Both receptionist tables are empty, both have RLS enabled, and the Data API roles have no read or truncate access to call records. No workspace was enabled and no phone routing was changed.

The application reverse patch was applied to a disposable archive of commit `4750b58`; all 26 affected paths matched base commit `3095401` exactly afterward. The disposable PostgreSQL recovery tests also passed. Do not apply the reverse patch to the live database or remove its additive tables.

The authenticated receptionist settings and unsigned webhook/admin boundaries were verified against the connected application. All 962 unit tests and 4 disposable PostgreSQL tests pass. The compiled-app smoke run has 18 passes and 5 legacy guard skips; the skipped navigation paths were checked manually without creating records. Phone activation remains disabled because no Twilio account has been connected.

## Tested database recovery

Run `npm run test:receptionist:integration` with Docker running and the existing `pgvector/pgvector:pg16` image available. The test never pulls an image, binds PostgreSQL only to localhost, uses synthetic data, and removes its disposable container afterward.

The integration test applies the complete migration history, checks Data API privileges, sends eight concurrent confirmations and verifies one callback, injects a failed task write and verifies transaction rollback, then disables the feature twice and verifies all call history and the control workspace remain unchanged.

Before the confirmed call, the synthetic database has one lead in the control workspace. After eight confirmations it has two leads total, one task, one call activity, and three audit entries. A failed callback leaves those counts unchanged and releases its claimed turn by rolling back the transaction. Disabling twice also preserves those counts and all saved call records.

## Existing database advisories

The pre-change advisor scan reported the project's existing server-only tables with RLS and no policies, two execution-grant advisories for `public.rls_auto_enable()`, and disabled leaked-password protection. The receptionist follows the server-only table pattern and revokes direct Data API grants on its new tables. It does not change existing functions, grants on other tables, or Auth settings.

References: [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous function execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated function execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
