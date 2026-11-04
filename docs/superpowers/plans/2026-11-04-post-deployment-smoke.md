# Post-deployment smoke implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Track the single task with checkboxes.

**Goal:** Automatically verify the production commit, public sign-in, and anonymous access denial after each main release.

**Architecture:** Add a final CI job after `Production release ready`, polling the fixed production origin for build-generated commit metadata before issuing anonymous GET requests. The existing native Vercel gate remains unchanged. The script needs only Node 22 built-ins and no credentials.

**Tech stack:** Node 22, existing Vitest, Next.js public assets, GitHub Actions.

**Spec:** The user's approved proposal in this chat: verify the intended commit and sign-in, check protected pages/APIs, report failure in Actions, use read-only requests and mocked failures, keep the widget off, and make no DeepSeek calls.

## Global constraints

- No new dependencies, secrets, database changes, business writes, login submissions, provider requests, widget changes, or external notification messages.
- Preserve unrelated `.serena/` and `.spec-workflow/` directories.
- Do not edit existing tests without approval. Add new regression files.
- Use existing full checks; run strict and fast types after the root build.
- Main production origin is `https://flowrish.marckengland.com`; callers cannot supply another origin.

## Review focus

- Missing or malformed build metadata must never approve an unknown commit.
- Redirects must not carry requests to another origin; request headers contain no credentials.
- Alias changes during checks must fail the final commit confirmation.
- HTTP/JSON/transport errors must produce safe, bounded failures without logging response bodies.
- The smoke job must depend on the dedicated release gate without joining the gate's prerequisites and creating a promotion deadlock.

## Decisions

The repository's observed deployment record is the Actions `Production` environment, not a reliable Vercel alias-promotion event. Attach the smoke job to the existing release workflow rather than depending on another webhook. Vercel's system commit environment variable is already exposed for this project. A generated `/release.json` contains only a validated commit ID, or null for an unconfigured local build. This avoids changing authentication middleware.

The public asset receives no-store response headers. The runner polls at most twenty times with ten-second gaps and five-second request deadlines. After the expected commit appears, it checks `/`, `/login`, `/dashboard`, `/forecast`, `/api/forecast`, `/api/receptionist/home`, and `/api/admin/website-receptionist`, then confirms the commit again. It never follows redirects, retains cookies, or submits forms. Body reads are bounded. Errors and the Actions step summary contain only known paths, statuses, and the validated commit ID.

This covers release regressions. Later outages and authenticated interactions remain outside this check. A failed smoke job reports the problem; it does not automatically roll back production.

## Task 1: Add and verify the release smoke flow

**Files:** Create `scripts/write-release-metadata.mjs`, `scripts/production-smoke.mjs`, `src/__tests__/release-metadata.test.ts`, `src/__tests__/production-smoke.test.ts`, `src/__tests__/production-smoke-cli.test.ts`, and `src/__tests__/production-build-command.test.ts`. Modify `package.json`, `vercel.json`, `.gitignore`, `next.config.ts`, `.github/workflows/ci.yml`, and `docs/ops/production-deployment.md`.

**Interfaces:** `writeReleaseMetadata({ root?, sha? })` writes `public/release.json`. `runSmoke({ expectedSha, fetchImpl?, sleep?, attempts?, log? })` returns a fixed-path result list or throws a safe failure. The CLI takes the expected commit from `SMOKE_EXPECTED_SHA` and writes the Actions summary when available.

- [x] Write new failing tests for exact metadata/privacy, missing/invalid SHA, anonymous GET-only checks, relative and absolute local redirects, rejected external redirects, failed public/sign-in/API responses, bounded metadata polling/body reads, transport failures, and a changed commit at completion.
- [x] Run `npm test -- src/__tests__/release-metadata.test.ts src/__tests__/production-smoke.test.ts`; observe the missing implementation fail.
- [x] Implement the two standard-library scripts and wire the build artifact, no-store headers, and post-gate job.
- [x] Run the narrow tests until green. Validate YAML with actionlint and verify the real generated static artifact and cache headers locally without external traffic.
- [x] Run `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`, `npm run typecheck:fast`, and `npm run test:receptionist:mocked`. Get one fresh whole-branch review and fix material findings with regression coverage.
Release procedure: commit, merge, check the merged tree, and push under the user's session authorization. Observe the exact new production commit and successful automatic smoke job. Confirm widget-off with read-only metadata.

## Rollback

Baseline app and workflow commit: `6e972f0216d8e8bae74369a7fb228ae5303533c9`; healthy deployment: `dpl_5YvDBXhdzJHc6KxsKBaqDUWMb89r`. A normal code revert removes the additional job and build asset. No settings, credentials, schema, or data need restoration. Prove the reversed patch restores the exact baseline tree in a temporary Git index before shipping. Keep the existing native Vercel gate and migration workflow intact. Never restore a database snapshot or force-promote unchecked code to undo a smoke-check failure.

Local evidence: 2,054 tests, lint, production build, strict and fast types passed. The 56-scenario mocked browser rehearsal passed without guard violations. The compiled root app served the synthetic commit marker with all no-store headers under a guard that blocked external sockets and private environment-file reads; zero violations. Fresh review found the production build-command bypass, now covered by a failing-then-passing configured-command regression. Approved NODE_ENV fixture corrections retained every assertion.
