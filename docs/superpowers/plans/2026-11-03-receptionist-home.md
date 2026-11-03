# Receptionist home implementation plan

**Goal:** Add `/receptionist` as the daily starting page for saved website-receptionist readiness, current callback work, missed response targets, and links to existing tools. User explicitly authorized implementation, fixes, mocked verification, and merge; existing session authorization covers push/deployment. Never read/decrypt/use the saved DeepSeek key or call AI/Twilio/real websites during verification.

**Architecture:** Read-only GET `/api/receptionist/home` returns a minimal, validated, permission-filtered snapshot from existing data in a repeatable-read transaction. Reuse the current local-organization permission union and live response-target SQL. No dependencies, schema, migration, settings change, auto-check, scheduler, CRM action, or new approval mechanism.

## Decisions

- Fresh Settings permission or CRM read/write permission and current membership are required, on the server page and GET. Administrators see pending handoffs and setup metadata; CRM users see open/overdue callbacks and contact target flags, across the organization for administrators and only current assignments for staff. Unavailable sections return null and are hidden, never a misleading zero. Foreign organization roles cannot contribute access.
- Website readiness uses valid saved business details, organization-owned provider metadata/limits, approved current public Library publications, and valid saved website origins/settings. Private phone notes/FAQs, drafts, stale approvals, deployment-wide AI credentials, and live connection status do not count. Only provider metadata is selected; never ciphertext or credentials. Display the saved enabled flag separately from saved prerequisites. Do not imply a successful installation, connection, or launch.
- Pending means confirmed pending source requests without a handoff receipt. Open CRM work matches the existing queue: active same-organization lead/task receipt, no closed callback, including manually completed tasks until the lifecycle closes. Overdue requires an incomplete task past its due time. Source deletion preserves approved CRM work. Counts and missed flags use one snapshot/as-of time. Reads never materialize targets or deliver notifications.
- Missed flags reuse the enabled current policy/version and source eligibility. Show whether targets are paused, awaiting a first check, or last checked; zero flags do not prove that targets were met. Restrict handoff/contact flags by current role and assignment.
- Add a sidebar Receptionist link using Settings OR (CRM read AND write), preserving existing nav-item semantics. The server page rechecks local permissions before mounting the client. Add a Settings entry and return links from setup/performance/response-target pages. Header titles must distinguish `/receptionist/setup` from the new root.
- Use existing Flowrish typography, neutral panels, green accent, native links, labelled statuses, and mobile/dark layouts. Refresh runs one GET, with no polling. Clear stale or unauthorized results; abort/unmount/request identity guards protect updates. All actions are links to existing approval workflows.
- Link installation to `/receptionist/setup?step=installation`. On initial snapshot only, show the existing simulation/install step if websites are saved, otherwise the website/budget step. Do not run a check, simulation, or activation. Add a stable `callback-work` anchor to the existing queue for `/tasks#callback-work`.

This read-only snapshot does not provide persisted installation health or historical daily activity; those would need separate retained evidence rather than inferred statuses.

## Tasks

1. Write failing contract and real disposable PostgreSQL tests, then implement `src/lib/receptionist-home.ts`, `src/server/services/receptionist-home.ts`, `scripts/receptionist-home.integration.test.ts`, and its Vitest config. Cover permission combinations, foreign roles, null visibility, current-assignment counts, callback lifecycle/deletion, stale target policies, actual public approvals, organization-provider metadata, safe DTOs, and unchanged business/AI data.
2. Write failing HTTP and page tests; implement authenticated no-store GET and a fresh local-permission page gate. Test session scope, malformed query rejection, safe errors, denial before mounting, stale session roles, removed membership, and propagation of database errors.
3. Write failing real UI/navigation/deep-link tests. Implement the home client, sidebar entry, links, header titles, safe install deep link, and callback queue anchor. Retain all existing test files/assertions. Check role-specific links, empty/readiness/paused states, explicit refresh, fixed diagnostics, stale responses, and zero provider/mutation calls.
4. Run full unit/lint/strict+fast types/Prisma/build, disposable PostgreSQL, new desktop/mobile/dark browser checks, and existing setup/callback/performance regressions. One independent whole-branch review; fix material findings through failing regressions. Document behavior/limits and normal-code-revert rollback. Prove the staged reverse restores the exact baseline, commit/merge, test merged tree, push, verify CI/deployment and production with mocked writes/read-only data.

## Review focus

- Local Settings/CRM combinations, removed membership, foreign roles and reassignment must not leak metadata, counts, task identities or unavailable-section totals.
- Private phone knowledge/global credentials/drafts/stale publications must not falsely satisfy website readiness or require key retrieval.
- Queue and missed counts must agree with current lifecycle, active CRM destinations, policy versions and assignment, without writes.
- Home refresh/navigation and installation shortcuts must not discard work, run tests, skip approvals, activate the widget, or spend provider credits.
- Error/stale/unmounted responses, first-check/paused states and mobile navigation must remain clear and accessible.

## Execution record

Baseline `333c2e94fed80dabe2c59261f4162870bf9e8064`. Preserve `.serena/` and `.spec-workflow/`. All provider and website transports must remain mocked/blocked; production verification is read-only or uses mocked business mutations.

- Implemented the scoped home snapshot, guarded page/API, explicit refresh UI, sidebar/Settings entry, return links, installation shortcut, and work-queue anchor. No existing tests were edited; no dependencies or migrations were added.
- Full unit run: 1,625 tests in 205 files passed. Strict TypeScript, fast types, repository ESLint autofix, Prisma validation, and the optimized production build passed. Prisma's existing legacy-configuration deprecation notice remains.
- Disposable PostgreSQL: home 8, response targets 20, performance 10, guided setup 10, and website receptionist 20 tests passed. Synthetic records and provider mocks only.
- Built-app browser verification: home 4 checks (including auth setup), then 16 existing setup, installation, handoff, outcome, target, and performance checks (including auth setup) passed. Desktop light and 390px mobile dark screenshots inspected; no horizontal overflow. The initial browser run exposed an ambiguous new test locator matching Next's route announcer; scoping it to main content retained the permission-message assertion and the rerun passed.
- Independent whole-branch review reported no Critical, Important, or Minor findings and independently passed all 28 new focused unit tests. No product changes followed review.
- The local build/server blocked AI and Twilio fetch transports and native website HTTPS; no blocked-attempt log was produced. Business mutations were mocked. Production read-only baseline: callbacks, handoffs, outcomes, notifications, policies, targets, and enabled widgets all zero.
- Rollback: reverse of the staged code/docs/tests restores the exact baseline tree in a temporary Git index. A normal merge revert is sufficient; no persistent schema, configuration, permission, or business-data change needs undoing. Release CI/deployment and production read-only/mocked checks are verified after pushing.

Not performed: live AI connection/credit checks, real website inspection, widget activation, provider-key retrieval/decryption, or production test-record creation. Persisted installation history and historical daily reporting remain outside this read-only page.
