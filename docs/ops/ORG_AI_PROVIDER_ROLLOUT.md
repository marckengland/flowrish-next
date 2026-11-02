# Organization AI provider rollout and rollback

## Recorded before state

On November 2, 2026, the deployed app was `6e8a430`. Read-only production inspection found no `AiProviderConfig` or `AiUsageDay` table. The latest recorded migration was `20261102080000_add_business_knowledge_library`. Existing deployment credentials were not read, changed, or copied.

The new migration `20261102091000_add_org_ai_provider` creates two tables and their organization foreign keys, uniqueness and limit constraints. It enables RLS and revokes PUBLIC, anon, and authenticated table access. It does not backfill, update, or delete existing data, grant browser access, or change environment secrets.

## Roll out

Run the full checks and disposable PostgreSQL suite first. Apply the additive migration with the repository's Prisma migration workflow before the new app version starts querying the tables. Confirm migration history, RLS, revoked API-role access and zero initial configuration/usage rows. Then deploy the reviewed code and load the authenticated AI provider panel. Opening or saving the panel must not call a provider; only an explicit connection test or an AI feature may do so.

Production verification must not replace an organization's real provider or key. An administrator can enter their DeepSeek key through the panel after deployment and explicitly test it. This release's automated provider tests use only synthetic credentials and intercepted network boundaries.

## Roll back

Revert the feature merge with `git revert -m 1 <feature-merge-sha>` and redeploy. Leave the additive tables, encrypted credentials and usage intact. The old app ignores them; removing them would delete user data. No reverse migration or encryption-key rotation is needed.

If organizations have begun using their own keys, the old code resumes its former deployment-wide provider behavior. Pause AI features or disable the deployment provider at its account before rolling back if that would create unwanted shared-provider charges. A rollback cannot undo provider requests already processed or charges already incurred.

Do not drop the credential tables, restore a full database snapshot, edit an applied migration, or expose encrypted keys through the Data API. Reapplying the reviewed version can use the preserved settings and daily reservations.

## Verification record

Before merge, 1,298 unit tests, 54 disposable PostgreSQL tests, both TypeScript engines, lint and production build passed. The compiled-app browser suite passed 40 tests; five existing guards skipped because their selectors found no eligible contact row, company row, cadence row, task card or New lead CTA. No test was weakened or skipped for this change. The approved legacy fixture changes retain their assertions and add organization context.

Independent review reproduced HTTP stream cancellation and incomplete-EOF bugs. Both were fixed; the real route/transport probe passed 2/2 afterward. A temporary copy accepted the full feature patch and its reverse, restoring the original tracked-file hashes.

The additive production migration applied successfully. Direct verification found both tables protected by RLS, anon/authenticated access revoked, zero configuration rows and zero usage rows. No real provider key was supplied and no real provider test was run during this release verification.
