# Saved bulk-action history

Save reviewed completion and deadline batches privately per user and workspace. Refreshing or opening another device must allow read-only inspection of confirmed, failed, uncertain, and unattempted requests. Never resume changes from history. Keep filters and unsent drafts intact.

## Constraints

No new dependencies, live AI, emails, public widget activation, or authenticated production test writes. Preserve every existing test and network guard. Use an additive Prisma migration with private RLS and membership cascade. Existing single-task APIs remain compatible.

## Task 1: Persistent intent and exact results

Write failing schema/projection/service/route tests, then implement a bounded immutable batch plan, owner-only registration and history, and server-marked sequential attempts. Audit receipts establish historical success; current task state alone cannot establish success. Recheck current lead/task access and redact unavailable entries. Test retries, partial failures, crash windows, later task edits, cross-user/workspace denial, and concurrent attempts.

Expected: narrow Vitest tests pass, no provider calls. Interfaces: batch registration echoes canonical intent; optional x-flowrish-task-batch header fences existing task POSTs; history GETs have no mutations.

## Task 2: Inbox history and registration

Test then add registration before the first task request, optional queue header, and lazy read-only saved history. A lost or mismatched registration response starts no task requests. Preserve drafts, filters, and current reviews. Add registration fixtures without changing existing assertions. Add six mocked browser scenarios, increasing 196 to 202.

Expected: narrow UI/helper tests and all 202 guarded browser scenarios pass. Interfaces: schemas from task 1; existing task request bodies and URLs remain unchanged.

## Task 3: Verification and release

Run the synthetic PostgreSQL migration/restore/concurrency drill with only disposable data. Verify private table privileges, atomic rollback, constraints, cascade, exact audit proofs, and no duplicate effects. Test application rollback by reverting/reapplying the staged diff in a temporary index; preserve the additive table on application rollback. Run npm test, lint, build, mocked rehearsal; strict and fast types only after Next builds finish. Obtain one fresh whole-change review, address important findings test-first, then commit, fast-forward main, push, and verify all CI jobs, exact production SHA/alias, anonymous API denials, private table catalog, and widget disabled.

Expected: every check observed green, migration count 43, enabled widgets 0, no production writes except reviewed deployment DDL.

## Tradeoff and exclusions

Intent-before-effect is standard write-ahead recording: a crash after marking an attempt remains uncertain until its exact audit appears. This intentionally makes automatic resumption harder. No retrospective grouping of earlier actions, durable pre-confirmation reviews, deletion policy, live provider tests, or automatic retries.

## Review focus

Check crash windows between marker/service/finish, exact audit input hashes, later task changes, batch ownership and revoked task visibility, concurrent/out-of-order task POSTs, stale browser responses, lost registration receipts, and preservation of drafts/filters. History must never repeat a mutation.
