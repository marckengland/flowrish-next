# Testing Guide

Flowrish has two independent test layers:

| Layer | Tool | What it covers | Runs in CI? |
|-------|------|----------------|-------------|
| **Unit / integration** | Vitest + fast-check | Services, server actions, validators, hooks, and component logic — with property-based tests for security-sensitive code | ✅ Yes |
| **End-to-end (e2e)** | Playwright | Real browser walks the authenticated app (route smoke tests, row navigation, create-form flows) | ❌ No (run manually / locally) |

---

## Unit tests (Vitest)

```bash
npm run test          # run the whole suite once
npm run test:watch    # re-run on change
npx vitest run path/to/file.test.ts   # a single file
```

- Test files live next to the code they cover (`*.test.ts`) or under `__tests__/` folders.
- **Property-based tests** (`fast-check`) assert invariants over many generated inputs — e.g. `src/server/services/__tests__/ai.property.test.ts` verifies that AI failures never leak API keys and that the admin system prompt is included/excluded correctly. These run 30 iterations each, so that file raises its own timeout (`vi.setConfig({ testTimeout: 15_000 })`) to stay stable on slower CI runners.
- No database or network is required — Prisma, Supabase, and `fetch` are mocked.

---

## End-to-end tests (Playwright)

Everything is driven by `playwright.config.ts`. `npm run test:e2e` and `npm run test:e2e:prod` are **not** a different tool — they both run `playwright test`; they only differ in **environment and target**.

### How a run works

1. **Server** — For a local run, Playwright starts the dev server itself on a **dedicated port `3100`** (`webServer` in the config). It frees the port first and never reuses an existing server, so tests always hit fresh code (Next.js does not hot-reload middleware, and `next dev` silently moves to `:3101` if `:3100` is taken — both traps this avoids). For a prod run, `webServer` is skipped and tests hit the deployed URL directly.
2. **`setup` project** (`e2e/auth.setup.ts`) — signs in **once**. Because auth is passwordless, it asks the Supabase admin API to mint a magic-link token for `E2E_TEST_USER_EMAIL`, drives the app's `/auth/confirm` route to exchange it for a session, and saves the cookies to `e2e/.auth/user.json` (gitignored).
3. **`chromium` project** — loads that saved `storageState` so every test starts already authenticated, then runs the specs.

### The specs (`e2e/`)

- **`smoke.spec.ts`** — visits every dashboard route (`/leads`, `/admin`, …), asserting HTTP < 400, the expected `<h1>`, and **zero console/page errors**; plus row-click navigation and the "New lead" CTA. Read-only.
- **`forms.spec.ts`** — tagged **`@write`**. Actually creates a task / cadence step and asserts success. These mutate data.

### Local vs. prod

| Command | Target | Server | `@write` specs | Parallelism |
|---------|--------|--------|----------------|-------------|
| `npm run test:e2e` | local `:3100` | auto-started | **run** | parallel |
| `npm run test:e2e:ui` | local `:3100` | auto-started | run | Playwright UI mode |
| `npm run test:e2e:prod` | deployed URL | none | **skipped** | serialized (1 worker) |
| `npm run test:e2e:prod:write` | deployed URL | none | run (writes!) | serialized |

- A run is treated as **prod** when `PLAYWRIGHT_BASE_URL` is present in the *ambient* environment. `test:e2e:prod` sets it via `node --env-file=.env`; a plain `test:e2e` deliberately drops a value that only lives in `.env`, so it always stays local.
- Against prod the config serializes (one worker, longer timeouts, 2 retries) to avoid tripping the app's Upstash rate limiter, and **skips `@write` specs** unless `E2E_ALLOW_WRITES=1` — so a prod smoke run never mutates the live database by accident.

### Required environment

Read from `.env` (the config loads it into the runner):

- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` — mint the magic link.
- `E2E_TEST_USER_EMAIL` — an existing user in the org you want to test.
- `EMAIL_ENCRYPTION_KEY` — a **valid 64-hex** value. Local runs boot the real app, and `/auth/confirm` validates the whole env schema; a placeholder key makes that route 500 and sign-in fails silently.

### First-time e2e setup

```bash
npm run test:e2e:install   # install the Chromium browser (+ OS deps)
npm run test:e2e
```

---

## What CI runs

`.github/workflows/ci.yml` runs on every push/PR: lint, `tsc --noEmit`, and the full Vitest suite. **Playwright is not run in CI** — it needs a live Supabase project and a seeded test user, so e2e is a local/manual gate. On merge to `main`, a separate job applies Prisma migrations (gated on the `SUPABASE_DB_URL` secret).

---

## Troubleshooting

**`auth.setup` fails: "No Supabase auth cookie after confirming the magic link" (local)**
The `/auth/confirm` route is 500-ing. Almost always a placeholder `EMAIL_ENCRYPTION_KEY` — set a real 64-hex value (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Also confirm the test user exists in the Supabase project and `SUPABASE_SECRET_KEY` is the service-role key.

**`RATE_LIMITED` / 429 during a prod run**
Rate limiting only applies to `/api/*`, but repeated prod runs can still trip the auth/write windows. Runs already serialize; wait for the window to reset, or wire `E2E_BYPASS_TOKEN`.

**Tests hit stale code / a server on the wrong port**
Local runs own `:3100` and kill anything on it before starting. If you keep a manual `next dev` on `:3000`, that's fine — it's untouched. Don't start your own server on `:3100`.

**Property test times out in CI**
These run 30 iterations; `ai.property.test.ts` already sets a 15s per-test timeout. If a new property test flakes on CI, give it a generous `testTimeout` or lower `numRuns`.
