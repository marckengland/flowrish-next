# Production deployment gate rollback

This rollback covers the deployment-ordering change based on app commit `48db5b1843308f924ac8b639c72a2c96ef8e245f`. It creates no schema change or business records. Never restore a database snapshot, delete an applied migration, or change the receptionist widget to undo it.

## Restore availability

Keep the release gate enabled. Restore the recorded verified deployment with the authenticated Vercel CLI:

```sh
CONFIRM_PRODUCTION_ROLLBACK=flowrish-next node scripts/production-rollback.mjs
```

The helper verifies the alias belongs to project `prj_AFfVtIp4EO7TqUmIzBYDzDPI8zeb`, restores deployment `dpl_23dQXYGhk6Vjzo824J5CfUrzLfXM`, then reads the alias again. It does nothing if that deployment is already active. It never removes gates, changes another project, or reads or prints credential values. Mocked round-trip tests cover restoration, a repeated no-op, and refusal of another project. This path was not executed against the live site because the existing deployment is healthy.

The restored URL is `flowrish-next-cuh6erp9o-marckenglands-projects.vercel.app`, containing the app base above. Expect the alias operation to complete within the helper's three-minute timeout. Inspect Vercel before retrying an unconfirmed result. Revalidate this recorded deployment before using the helper after future application/schema releases.

## Restore configuration deliberately

Use this only to abandon the new release process. A failed release can safely remain blocked while it is repaired.

1. Keep the verified production alias active. Cancel queued/building release candidates and confirm that no ready deployment is waiting to promote. Removing a check while a candidate is waiting could release unchecked code.
2. Revert this change's workflow and helper files through normal Git review. Do not rewrite shared history. Preserve unrelated changes.
3. Read the project's checks through `vercel api /v2/projects/flowrish-next/checks --scope marckenglands-projects --raw`. Identify only the check created for this change by its recorded ID, name `Production release ready`, and GitHub source. Delete only that ID using the matching Vercel endpoint. Do not remove other checks.
4. The `Production` environment existed before this change. Do not delete it. Remove only the custom `main` deployment-branch policy created here, then restore its prior policy with a PUT request body `{"deployment_branch_policy":null}` to `repos/marckengland/flowrish-next/environments/Production`. Its original protection-rules list was empty. Stop if another administrator has added rules since this change.
5. The environment secret `SUPABASE_DB_URL` was originally absent. If its metadata still matches the creation recorded for this change, remove it with `gh secret delete SUPABASE_DB_URL --repo marckengland/flowrish-next --env Production`. Never print, copy into a command argument, or check in the value. Do not change the local or Vercel database credentials.

The previous pipeline skipped migrations when that secret was absent and Vercel had no deployment check. Restoring that configuration requires manual schema-before-code coordination again. Normal production releases should keep the new protection.

## Recorded state

- Existing GitHub environment: `Production`, id `15468830230`, original updated time `2026-05-18T07:45:55Z`.
- Original branch policy: null. Original environment and repository secrets: empty.
- Original Vercel checks: empty. Automatic custom-domain assignment: enabled; Git production branch: `main`.
- This file contains no secret values. Record only new check IDs, branch-policy IDs, and secret creation/update timestamps after setup.

Setup records from November 4, 2026:

- New Vercel check: `chk_68486ee4-eb4a-4056-8d73-ecffa1d578f4`, name `Production release ready`, production-only, GitHub source with the same external check name, blocks `deployment-alias`.
- New GitHub branch policy: `65471478`, name `main`, type `branch`, inside the existing `Production` environment.
- New environment secret metadata: `SUPABASE_DB_URL`, updated `2026-11-04T10:07:02Z`. Repository secrets remain empty. Do not delete the secret if its update metadata has changed since this setup.
- Readback confirmed the reviewed check configuration, exactly one main branch policy, and the unchanged verified production alias. No other setting or credential was overwritten.
