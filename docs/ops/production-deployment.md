# Production deployment

Main pushes run the existing lint/type/unit job and isolated mocked browser rehearsal. The migration job starts only after both succeed and runs inside the GitHub `Production` environment, restricted to the `main` branch. A missing database secret fails the job.

The environment secret `SUPABASE_DB_URL` contains the Flowrish direct/session connection on port 5432. Provide it through GitHub's environment-secret UI or encrypted stdin with `gh secret set`; never place a connection value in command arguments or files in this repository. Dependency installation receives dummy localhost URLs. Only the migration step receives the production credential. Prisma runs with an explicit temporary configuration, a minimal child environment, and the pinned public Supabase trust root. Raw datasource output is withheld.

`Production release ready` is the production-only GitHub check. It verifies the tested commit is still current main and requires explicit success from every prerequisite. Failed, skipped, canceled, or stale results do not approve release. PRs use a different job name so a skipped PR job cannot satisfy the production check for the same SHA.

Vercel builds through its existing Git integration while CI runs. The native check defined in `scripts/production-release-check.json` holds production-domain assignment until the exact GitHub check passes. Preview builds remain available. A privileged manual Force Promote remains an administrative bypass; do not use it for routine releases.

Configuration payloads are versioned in `scripts/production-release-environment.json` and `scripts/production-release-branch.json`. Changing the release job's name requires updating the matching Vercel check. Main runs serialize without interrupting active migrations. The latest queued run can replace an older pending run; canceled runs cannot approve release.

Verification covers the rejection paths with mocks, validates workflow syntax with actionlint, and observes the real alias remain on its preceding verified deployment while production checks are pending. Operational migration checks inspect migration metadata only; verification never creates business records, sends email, enables the widget, or calls DeepSeek.

For the recorded verified deployment and emergency instructions, see [the rollback runbook](./production-deployment-rollback.md). Restore availability without removing the gate. Reverting application code does not reverse an applied database migration.
