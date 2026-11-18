# Production deployment

Main pushes run lint/type/unit checks, the isolated mocked browser rehearsal, secret-free synthetic inbox regressions, and startup/public-source checks on Linux and Windows. The migration job starts only after every prerequisite succeeds and runs inside the GitHub `Production` environment, restricted to the `main` branch. A missing database secret fails the job.

The environment secret `SUPABASE_DB_URL` contains the Flowrish direct/session connection on port 5432. Provide it through GitHub's environment-secret UI or encrypted stdin with `gh secret set`; never place a connection value in command arguments or files in this repository. Dependency installation receives dummy localhost URLs. Only the migration step receives the production credential. Prisma runs with an explicit temporary configuration, a minimal child environment, and the pinned public Supabase trust root. Raw datasource output is withheld.

`Production release ready` is the production-only GitHub check. It verifies the tested commit is still current main and requires explicit success from every prerequisite. Failed, skipped, canceled, or stale results do not approve release. PRs use a different job name so a skipped PR job cannot satisfy the production check for the same SHA.

Vercel builds through its existing Git integration while CI runs. The native check defined in `scripts/production-release-check.json` holds production-domain assignment until the exact GitHub check passes. Preview builds remain available. A privileged manual Force Promote remains an administrative bypass; do not use it for routine releases.

Configuration payloads are versioned in `scripts/production-release-environment.json` and `scripts/production-release-branch.json`. Changing the release job's name requires updating the matching Vercel check. Main runs serialize without interrupting active migrations. The latest queued run can replace an older pending run; canceled runs cannot approve release.

Verification covers the rejection paths with mocks, validates workflow syntax with actionlint, and observes the real alias remain on its preceding verified deployment while production checks are pending. Operational migration checks inspect migration metadata only; verification never creates business records, sends email, enables the widget, or calls DeepSeek.

For the recorded verified deployment and emergency instructions, see [the rollback runbook](./production-deployment-rollback.md). Restore availability without removing the gate. Reverting application code does not reverse an applied database migration.

## Verify production after promotion

The `Production smoke verification` job follows the dedicated release gate. It waits for the fixed production domain to serve the expected commit, then checks public pages, the sign-in form, and anonymous denial for protected pages and APIs. A final commit check rejects an alias change during verification. It uses anonymous GET requests and never follows redirects, submits forms, changes widget settings, creates business records, or calls an AI provider.

The build generates `/release.json` from Vercel's `VERCEL_GIT_COMMIT_SHA`. This public file contains only the validated commit ID, or null for an unconfigured local build. Browser and CDN caching are disabled for this path. The file is generated during `npm run build` and is not tracked in Git. `vercel.json` runs `prisma generate && npm run build` so the production build generates the marker too. Vercel system environment variables are already enabled for this project.

The job uses Node built-ins without dependency installation or service credentials. It polls metadata at most twenty times with ten-second gaps and five-second request deadlines. Response reads are bounded. Failure output contains known route names without response bodies or transport details; the Actions step summary records success or failure. A failed smoke job marks CI failed after promotion and requires investigation. It does not automatically restore a previous deployment.

To repeat the read-only verification for the current production commit, run `SMOKE_EXPECTED_SHA=<40-character-commit> node scripts/production-smoke.mjs`. Re-running an old commit after a newer release will fail the commit check. Later outages and authenticated workflows require separate monitoring and testing.

Rollback is a normal revert of the smoke-check change and deployment. The existing release gate and migration job remain in place. No database, credential, or project-setting restoration is needed.
