# Deploy or roll back the business knowledge library

## Record the baseline

The base app commit is `75bb2fd`. The read-only production check on November 2, 2026 found 10 leads, 7 tasks, 9 activities, 1 mailbox, 10 email messages, 0 follow-up suggestions, and 0 receptionist configurations. Neither knowledge table existed. No customer content or credentials were copied into this record.

The forward migration `20261102080000_add_business_knowledge_library` adds `KnowledgeDocument` and `KnowledgeChunk`, their constraints, a full-text trigger, indexes, and RLS. It changes no existing customer rows. Direct `anon` and `authenticated` access to both new tables is revoked. App services enforce organization and permission checks.

## Verify before deployment

Use Node 22, matching CI and the PDF parser requirement. The approved dependencies are pinned to `unpdf@1.9.1` and `mammoth@1.13.0`.

Run these checks from the repository root:

```sh
npm test
npm run lint
npm run typecheck:fast
npx tsc --noEmit
npm run build
node --import tsx scripts/verify-knowledge-worker-trace.ts
node_modules/.bin/vitest run --config vitest.knowledge.config.ts
node_modules/.bin/vitest run --config vitest.follow-up-drafts.config.ts
node_modules/.bin/vitest run --config vitest.mailbox-sync.config.ts
node_modules/.bin/vitest run --config vitest.follow-ups.config.ts
npm run test:receptionist:integration
```

The PostgreSQL suites use disposable Docker containers and synthetic data. Run `e2e/knowledge.spec.ts` against a compiled app as well. Its management requests use intercepted fixtures. Its real PDF and DOCX requests extract synthetic files without saving documents. Check the library IDs before and after extraction.

The parser worker has a 15-second timeout, a 192 MB V8 heap, bounded input and output, and an environment without application secrets. DOCX validation checks archive bounds and expanded sizes before parsing. This is process isolation, not an operating-system sandbox. Keep the parser dependencies current through separately reviewed upgrades.

After the checks pass, apply the migration and verify the new tables, RLS, and empty library. Deploy the app. Verify authenticated library access and actual PDF and DOCX extraction again on the deployed app. Check CI and the deployment status. No live phone calls, customer AI prompts, or email sends are required.

## Roll back the app while retaining knowledge

Use this procedure for broken uploads, incorrect retrieval, or unexpected errors after deployment:

1. Revert the feature merge with `git revert -m 1 <business-knowledge-merge-sha>`.
2. Run the normal checks and push the revert to deploy the prior app.
3. Retain both knowledge tables, saved drafts, published snapshots, approvals, and migration history. The previous app ignores these additive tables.
4. Start a new Airish chat before using the old app's CRM actions. The previous app does not filter knowledge-answer provenance from existing chat history.
5. Verify the existing receptionist manual FAQ settings and callback behavior. The previous app does not read the library.

The recorded fallback app is `75bb2fd`. The rollback does not delete knowledge, send messages, or restore a database snapshot. A later redeployment of the feature reads the retained library again, including its saved approvals. Review public approvals before re-enabling caller access after an incident.

Do not drop the new tables, edit an applied migration, force-push main, or restore the whole database to undo this feature. Those actions can destroy saved knowledge or unrelated customer changes. A normal code revert and deployment should take one build cycle. Deployment access and a passing build are prerequisites.

## Deferred paths

OCR, XLSX, original-file downloads, external URL ingestion, embeddings, and a historical version browser are deferred. Revocation is effective on the next retrieval and cannot recall an answer already in flight. Live telephony verification remains unavailable until a receptionist and voice provider are configured. Synthetic tests cover the signed webhook and callback flow.

## Verification record

Local verification passed on November 2, 2026: 1,163 unit tests, 36 disposable PostgreSQL integration tests, lint, both TypeScript checkers, and the production build. The six focused browser checks passed, including authentication setup, publication and public approval, upload review, actual compiled-server PDF and DOCX extraction, and unauthenticated rejection. Extraction left library IDs unchanged. A 390-pixel viewport check found no horizontal overflow.

Applying the forward patch and its reverse in a disposable archive restored all 578 baseline tracked-file hashes. After the real migration, the library had zero documents and zero chunks, both tables had RLS enabled, and all captured customer counts remained unchanged. The library starts empty so administrators can supply their actual business information.

The dependency audit reports 119 existing findings across the repository. None affect the newly added parser dependency closure. Unrelated dependency upgrades were not included.

The full compiled-app browser run passed 33 checks. Four pre-existing navigation checks skipped because their selector guards found no eligible targets: contact row, cadence row, task card, and New lead CTA. They were not reported as passed or changed for this feature. Live telephone calls and customer prompts to the AI provider were not exercised.

The production trace check also passed both file formats from an isolated directory containing only the deployment trace's files. This verifies the worker and its runtime parser dependencies without relying on the rest of the development checkout.
