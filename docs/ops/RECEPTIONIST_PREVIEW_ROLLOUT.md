# Deploy or roll back receptionist onboarding and preview

## Record the baseline

Base app: `7385b48`. On November 2, 2026, the read-only production check found 10 leads, 7 tasks, 9 activities, zero receptionist configurations, zero receptionist calls, and zero voice configurations. No phone account, phone number, forwarding route, or saved business configuration was changed.

This release adds no dependencies, migrations, or secret settings. Existing receptionist configurations remain in the same table and format. The preview reads saved configuration and approved knowledge. Preview requests write no CRM, call, audit, or configuration records. Saving settings remains a separate explicit administrator action.

## Verify

Use Node 22. Run the full unit suite, lint, both TypeScript engines, and production build. Run the disposable PostgreSQL suites, including:

```sh
node_modules/.bin/vitest run --config vitest.receptionist-preview.config.ts
npm run test:receptionist:integration
node_modules/.bin/vitest run --config vitest.knowledge.config.ts
node_modules/.bin/vitest run --config vitest.follow-up-drafts.config.ts
node_modules/.bin/vitest run --config vitest.mailbox-sync.config.ts
node_modules/.bin/vitest run --config vitest.follow-ups.config.ts
```

`e2e/receptionist-preview.spec.ts` uses intercepted synthetic configuration and conversation responses for the UI flow. Its live API checks read readiness, reject an unconfigured preview, and test authentication without saving configuration or invoking an AI provider. The PostgreSQL suite uses a mocked provider and real permissions, publication, retrieval, and callback state transitions. It asserts that database counts and saved configuration remain unchanged by preview.

Review organization-specific permissions. A user who administers workspace A but only reads workspace B must not inspect or preview B's receptionist. Both service functions enforce `getEffectivePermissions(userId, organizationId)` after checking current membership. Browser input cannot override the organization or business configuration.

After deployment, verify CI, the deployment commit, the focused live browser checks, and unchanged production counts. Do not describe browser or synthetic tests as a successful real phone call.

## Roll back

Revert the onboarding/preview feature merge with `git revert -m 1 <preview-merge-sha>`, run normal checks, and deploy. Retain existing receptionist settings, approved knowledge, and call history. No database or credential restoration is required because this release makes no schema or automatic configuration changes.

A rollback removes browser preview and guided setup. The existing receptionist editor and phone webhook remain available. If an administrator saved settings while using the new UI, those intentional settings survive. Do not drop tables, delete call history, reset the database, change phone routing, or force-push main to undo this code-only feature.

Recovery takes one deployment cycle. Reverting code cannot recall an AI response already generated, cancel a phone call already in progress, or undo settings changes made separately by an administrator.

## Verification record

Local checks passed on November 2, 2026: 1,203 unit tests, 41 disposable PostgreSQL integration tests, lint, both TypeScript engines, and production build. The full compiled-app browser run passed 37 checks. Four pre-existing navigation guards skipped because their selectors found no eligible targets: contact row, cadence row, task card, and New lead CTA. Those were not changed or counted as passes.

The organization-permission regression was observed failing before the fix, then passing with organization-specific `admin:settings`. The preview database suite verifies unchanged leads, tasks, activities, call records, audit entries, follow-up suggestions, and saved configuration. Speech resilience tests cover late responses after stopping/unmounting, synthesis errors, and intentional playback cancellation.

A forward/reverse patch round trip restored all 605 baseline tracked-file hashes in a disposable archive. No database restoration or phone-routing rollback is required. UI conversation responses were mocked; no real-phone call, microphone input, or live AI-provider conversation was tested.
