# Test Flowrish

Use Node.js 22. Install locked dependencies with `npm ci` before application tests. Use synthetic inputs and your own test services. Do not point tests at the hosted Flowrish database.

## Choose the test layer

| Layer | Command | External services | CI |
|-------|---------|-------------------|----|
| Startup scripts | `npm run test:startup` | None; temporary directories and synthetic commands | Linux and Windows |
| Public source and docs | `npm run test:public-repository` | None; Git and Node built-ins | Linux and Windows |
| Unit and property tests | `npm test` | Mocked database, authentication, and provider transports | Yes |
| Isolated browser rehearsal | `npm run test:receptionist:mocked` | Local fixture server and installed Chromium | Yes |
| Synthetic database workflows | `npm run test:inbox:performance`, `npm run test:compose-drafts:synthetic`, `npm run test:send-results:synthetic` | Disposable local Docker PostgreSQL | Yes |
| Authenticated application E2E | `npm run test:e2e` | Your Supabase test project, user, and configured application services | Manual |

## Run the full development checks

```sh
npm run test:startup
npm run test:public-repository
npm test
npm run lint
npm run test:receptionist:mocked
npm run build
npx tsc --noEmit
npm run typecheck:fast
```

Install Chromium first with `npm run test:e2e:install` if it is unavailable. Complete both the browser fixture build and main application build before running strict and fast type checks. Next.js replaces generated types during builds, so do not run those checks concurrently.

A build requires the configuration described in the [setup guide](SETUP_GUIDE.md). CI uses inert placeholders rather than production credentials. No AI provider is needed for normal verification.

## Run focused unit tests

```sh
npx vitest run src/__tests__/production-release.test.ts
npm run test:watch
```

Vitest covers services, actions, validators, hooks, and components. Property tests use fast-check to exercise generated inputs. Tests belong beside the implementation or under `__tests__`. Preserve assertions and behavior when fixing a fixture; do not skip checks to obtain a green run.

## Verify browser workflows without credentials

`npm run test:receptionist:mocked` builds the separate fixture app under `e2e/rehearsal-app`. It imports real client components and intercepts API responses using synthetic records. It needs neither Supabase authentication nor an AI key.

The runner removes inherited credentials, blocks private environment-file reads, and restricts server sockets and Chromium traffic to the fixture. Negative probes exercise those guards. Unmocked writes, provider calls, email, phone calls, and widget activation fail the rehearsal. Results are written under ignored `test-results/rehearsal`.

This suite verifies workflow behavior, including drafts, access changes, confirmations, and recovery. It does not measure live AI quality or physical microphone and telephone behavior. See the [fixture guide](../e2e/rehearsal-app/README.md).

## Verify database behavior in isolation

The three synthetic commands in the table own disposable PostgreSQL containers and use synthetic records. They check bounded inbox queries, draft storage, duplicate protection, concurrency, access changes, and rollback. Read the relevant runner's prerequisites before starting Docker; do not substitute a remote database URL.

Other integration configurations, such as `vitest.knowledge.config.ts` and `vitest.receptionist-preview.config.ts`, require an explicitly validated loopback test datasource. Follow `AGENTS.md`: copy the schema to a temporary directory, generate SQL offline with explicit dummy configuration, and apply it through `docker exec psql` inside the disposable container. Never run `prisma db push` from this checkout. Root Prisma configuration gives `.env` precedence over shell datasource variables.

The separate `npm run test:recovery:synthetic` drill verifies synthetic dump/restore behavior. It does not back up production or establish production recovery readiness. See the [recovery guide](ops/backup-recovery.md).

## Run authenticated application tests

Use a dedicated test installation and synthetic account. Configure `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `E2E_TEST_USER_EMAIL`, and a valid 64-hex `EMAIL_ENCRYPTION_KEY` in your private environment. The setup project mints a magic-link session and stores browser state in ignored `e2e/.auth`.

```sh
npm run test:e2e:install
npm run test:e2e
```

Local E2E owns port 3100 and may create records through write-tagged tests. Do not run an unrelated server on that port. Never commit authentication state, reports, or test traces.

For a deployed test installation, set `PLAYWRIGHT_BASE_URL` and use `npm run test:e2e:prod`. That command skips `@write` tests unless writes are explicitly enabled. Authentication and reads still contact your configured services. `npm run test:e2e:prod:write` explicitly permits writes and belongs only in an authorized test installation.

## Understand the release gate

CI runs on pushes to main and pull requests targeting main. It runs startup/public-source checks, lint, strict types, unit tests, isolated browser workflows, and synthetic database checks.

Production jobs run only for main pushes in the maintainer repository. They require successful prerequisites and the configured Production environment, apply reviewed migrations, verify the exact release commit, and check anonymous access after promotion. Public forks run validation without access to Flowrish's deployment secrets. See the [deployment guide](ops/production-deployment.md).

## Keep live tests explicit

Live AI, native speech, mailbox, and phone checks are separate from mocked verification. They require explicit authorization, synthetic inputs, configured accounts, and an agreed request budget. Saving AI settings does not authorize a live test. See the [live AI procedure](ops/RECEPTIONIST_LIVE_AI_TEST.md) and [browser preview guide](RECEPTIONIST_PREVIEW.md).
