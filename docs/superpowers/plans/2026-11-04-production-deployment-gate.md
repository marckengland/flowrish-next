# Ordered production deployment

Goal: production promotion must wait for the exact commit's unit/lint/types, mocked browser rehearsal, and successful Prisma migrations. Use the existing Vercel Git integration and native GitHub Deployment Check rather than adding deployment tokens or rebuilding a custom deployment service. Preserve preview builds and the existing production site while checks run. No dependencies, application features, schema, widget, business-record writes, emails, or live AI verification.

## Decisions

- Keep the existing CI jobs. Serialize main push workflows without canceling an active migration. PR concurrency remains separate. Add a production-only final check named `Production release ready` that runs even when prerequisites fail, and accepts only explicit success from every required job. PRs use a different check name, preventing a skipped PR check from satisfying the production gate for the same SHA.
- Restrict the existing GitHub `Production` environment to the `main` branch. Store the existing verified Flowrish session/direct database credential as the environment secret `SUPABASE_DB_URL`, using encrypted stdin through gh; never log it, include it in arguments, or write its value to an artifact. The credential is available only to the main-branch migration step. npm installation and PR tests receive dummy URLs.
- Before migration and before the final gate, check that the workflow SHA is still current main. Reject forks, PRs, other refs, failed/skipped/canceled prerequisites, stale commits, missing credentials, wrong database targets, and non-session pooler ports. Use TLS and an explicit temporary Prisma configuration so local .env overrides cannot redirect migrations. Capture Prisma output and print only safe success/error codes.
- Vercel native check: source GitHub, exact check name, production target only, blocks domain assignment/promotion with a one-hour timeout. Builds can finish while CI runs; the current domain stays on the preceding verified deployment until the gate succeeds. No new Vercel token, action dependency, or application budget.
- Test failure/skip/stale/secret/redaction paths with mocks. Test reversible external configuration commands using fake CLI transports before applying settings. Preserve a rollback file before changing any external setting. Obtain one fresh whole-change review before shipping.

Tradeoff: release latency follows CI, and a check rename requires updating Vercel's matching setting. This protects automatic promotion; existing privileged manual Force Promote remains an administrative bypass. Schema rollback remains forward-only and outside this workflow change.

## Before state

- Base `48db5b1843308f924ac8b639c72a2c96ef8e245f`; clean tracked tree, unrelated `.serena/` and `.spec-workflow/` preserved. Branch `codex/production-deployment-gate`. Baseline 2,004 tests / 290 files passed.
- GitHub repo `marckengland/flowrish-next` is private. Repository secrets list is empty. Existing `Production` environment id `15468830230`, created/updated `2026-05-18T07:45:55Z`, has no protection rules, no deployment branch policy, and no environment secrets.
- Vercel project `prj_AFfVtIp4EO7TqUmIzBYDzDPI8zeb`, team `team_AkMymNmH4juqLC2iUxJAhWAv`, scope `marckenglands-projects`, Git production branch `main`, automatic custom-domain assignment enabled. Configured deployment checks: empty.
- Current healthy deployment `dpl_23dQXYGhk6Vjzo824J5CfUrzLfXM`, URL `flowrish-next-cuh6erp9o-marckenglands-projects.vercel.app`, source `48db5b1843308f924ac8b639c72a2c96ef8e245f`.
- Official docs and OpenAPI support native GitHub checks via `/v2/projects/{projectIdOrName}/checks`; existing installed Vercel CLI is authenticated and can use this API. No connector exposes these settings, so use Vercel CLI. GitHub connector lacks secret/environment configuration; use gh for that scoped work.

## Tasks

- [x] Add failing guard, safe-migration, and rollback tests; implement minimal standard-library helpers and document the tested undo.
- [x] Harden CI ordering/permissions/credential scope and add the dedicated release-ready check. Run actionlint, focused tests, and full relevant project checks.
- [x] Obtain fresh review and fix demonstrated findings. Apply only the named environment policy, missing environment secret, and new Vercel check after undo verification; read back metadata without secret values.

## Release verification procedure

Integrate and push under existing session authorization. Observe the production alias stay on the old release while checks are pending, then move only after exact-commit tests and migrations succeed. Verify public and anonymous API health read-only. GitHub's final run and Vercel's matching check-run/alias records are the release evidence; do not create another deployment merely to update this planning checklist.

## Sources

- [Vercel Deployment Checks](https://vercel.com/docs/deployment-checks)
- [Create a native project check](https://vercel.com/docs/rest-api/checks-v2/create-a-check)
- [GitHub environment protection](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

## Ledger

- Implemented a standard-library release guard and hardened workflow. Ten initial mocked guard tests passed after fixing a bundler-specific parent-URL path resolution in production code; existing assertions were unchanged. A further failing regression required a trusted public CA. Current focused guard/rollback verification passes 13 tests; actionlint passes.
- Downloaded the public Supabase Root 2021 CA from the URL used by Supabase Studio's primary-source configuration: `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`. Two older guessed supabase.com download URLs returned 404; switched to the authoritative Studio source instead of retrying guesses. Public CA SHA-256 fingerprint `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, valid through April 26, 2031. This is a public trust certificate, not a private key or secret.
- Native macOS Prisma strict-TLS read-only preflight returned `P1011: The certificate was not trusted.` OpenSSL against the same endpoint and bundled root passed both chain and hostname verification, `Verify return code: 0 (ok)`. Verification is not being weakened. Investigating the client/platform difference before setting external credentials. No external settings have changed.
- Prepared an emergency availability rollback helper. Mocked round trip restores the recorded deployment once, is a no-op on repeat, and leaves gates and other projects untouched. The current alias read-only lookup matches the recorded healthy deployment/project. Document full settings undo separately; never remove a release gate while an unchecked candidate could promote.
- Reconsidered the macOS preflight after isolating the server's valid TLS chain. Verified the installed Prisma engine version on the existing Linux Node container with the bundled certificate: status 0, schema up to date, no error codes. Downloaded only the matching platform binary for the already-installed Prisma dependency and checked its vendor SHA-256; no package/dependency changes. Production runner remains Ubuntu/Node 22, whose actual migration step must pass before promotion. Local macOS Prisma TLS remains a platform limitation, not a reason to disable verification.
- Current focused verification passes 14 tests covering guards, native-check contract, minimal credential environment, redacted failures, pinned CA, and rollback. Existing tests are unchanged. Workflow actionlint and fast TypeScript pass. Full checks and fresh review are next; external settings are still unchanged.
- Full checks passed: 2,018 tests in 292 files; all 56 browser scenarios and eight safety probes with zero guard violations; ESLint; guarded production build; both post-build type checks; actionlint. Fresh review independently passed all 14 focused tests and actionlint, with no actionable P1/P2. The temporary Prisma config was parsed offline.
- Applied only the reviewed external settings after matching the recorded before-state. Existing Production environment now permits only branch main, policy id `65471478`. Stored the verified direct/session credential through sealed stdin as environment secret `SUPABASE_DB_URL`, metadata updated `2026-11-04T10:07:02Z`; no repository secret or plaintext credential artifact was created.
- Created native check `chk_68486ee4-eb4a-4056-8d73-ecffa1d578f4`. Readback matches production-only target, GitHub `Production release ready`, block `deployment-alias`, timeout 3600. The preceding production alias remains unchanged. Exact settings undo metadata is parked in the rollback runbook; emergency availability restoration remains mock-tested, not exercised live.
