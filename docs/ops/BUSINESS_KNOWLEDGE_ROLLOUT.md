# Deploy or roll back the business knowledge library

## Migration and compatibility

The forward migration `20261102080000_add_business_knowledge_library` adds `KnowledgeDocument` and `KnowledgeChunk`, their constraints, a full-text trigger, indexes, and RLS. It changes no existing customer rows. Direct `anon` and `authenticated` access to both new tables is revoked. App services enforce organization and permission checks.

## Verify before deployment

Use Node 22, matching CI and the PDF parser requirement. The approved dependencies are pinned to `unpdf@1.9.1` and `mammoth@1.13.0`.

Run these checks from the repository root:

```sh
npm test
npm run lint
npm run build
npx tsc --noEmit
npm run typecheck:fast
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
