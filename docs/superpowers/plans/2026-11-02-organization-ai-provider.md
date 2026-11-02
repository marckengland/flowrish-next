# Organization AI provider implementation plan

**Goal:** Add administrator-managed provider/model/encrypted credentials in Settings, with explicit connection testing and conservative organization usage limits.

**Approved scope:** The organization-settings design proposed in this chat and the user's “pls add it”. Existing global provider remains the fallback only for organizations without a config row. A paused, invalid, exhausted, or failed organization config never falls back to shared credentials.

**Architecture:** Three allowlisted OpenAI-compatible hosts (DeepSeek, Gemini, OpenAI), explicit organization context through every AI caller, fresh config resolution per request, AES-256-GCM key encryption bound to organization and provider using the existing server encryption master. Add server-only configuration and daily usage tables with RLS enabled and browser-role grants revoked. Daily request and conservative token reservations are atomic; failed/interrupted calls retain reservations. Provider-reported usage is displayed separately. These are application limits, not a dollar billing guarantee. No prompts, replies, or raw provider errors are stored as usage.

**Defaults:** 20 requests per UTC day; 50,000 reserved tokens; 2,048 maximum output tokens; 16,000 input bytes per request. Output uses the lower of the feature allowance and org maximum. DeepSeek thinking is disabled. Connection tests make one short bounded request only on explicit action; saves make none. No dependencies added.

**Shared contract:** `src/lib/ai-provider.ts` owns safe view types, providers and validation. Settings API GET/PUT at `/api/admin/ai-provider` returns `{data: AiProviderSettingsView}`. POST `/api/admin/ai-provider/test` accepts `{expectedUpdatedAt: string}` and returns `{data:{ok:true}}`. Errors use AppError/errorResponse. No secret/ciphertext is returned. No delete endpoint in this release; a pause keeps config and prevents fallback. Provider changes require a replacement key; blank key preserves only the same provider. Optimistic version checks prevent stale saves and tests.

## Tasks

1. Main: add Prisma tables, migration/RLS and tenant-scoping registration, then regenerate Prisma. Verify additive rollback, schema consistency and disposable PostgreSQL concurrency/isolation checks.
2. Backend worker: new `org-ai-provider.ts`, authenticated encryption helper, admin routes, narrow new tests. Runtime contract: `resolveOrganizationAi(orgId): Promise<OrganizationAiRuntime|null>`, `reserveAiUsage(runtime,inputBytes,outputTokens): Promise<AiReservation>`, `finishAiUsage(reservation,{success,totalTokens?}): Promise<void>`. Runtime includes organizationId, version Date, provider/baseUrl/model/apiKey and four limits; reservation includes organizationId/day Date/reservedTokens. Only absent config returns null. New services always explicitly scope DB queries to org and current-member/admin settings actions.
3. UI worker: Settings AI provider panel from shared view contract, masked password input, provider/model selection, limits, pause, usage, save/version-conflict recovery and explicit test requiring saved unchanged form. No credential persistence in browser storage, no automatic tests. New component and browser fixtures/tests only.
4. Main: pass org context through all AI completions/streaming/receptionist/follow-up generation; reserve before fetch and complete usage after outcome; sanitize provider/network logs; add new integration tests for tenant routing, caps, no-fallback, stream cancellation, DeepSeek body and input rejection. Make global AI key optional so an org key needs no deployment key.
5. Verify all units, both TypeScript engines, formatter/linter, build, all disposable database suites and browser regressions. Independent security review, fix findings, merge/push under session authorization, apply additive migration and verify CI/deployment and hosted settings without spending or entering a real user key.

## Review focus

Cross-org reads/writes/key substitution; stale saves or connection tests; simultaneous reservations and midnight completion; provider errors leaking keys; response redirects carrying authorization; stream cancellation retaining budget; hidden reasoning consuming output budget; missing/paused configs; and a global key accidentally overriding an organization setting.

## Tradeoff and rollback

Fixed endpoints make arbitrary gateways harder to add, but avoid SSRF and credential exfiltration. Conservative reservations can reject a request while actual billed usage is lower. Revert the code to roll back, leave the two additive tables and their RLS restrictions in place, and preserve any real saved organization credentials and usage. Never drop user configuration or restore a whole database snapshot to undo this feature. Synthetic fixture cleanup must match exact owned IDs/versions.
