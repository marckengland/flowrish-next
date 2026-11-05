# Callback catch-up implementation plan

> Use superpowers:executing-plans inline, TDD, and one fresh whole-branch review.

**Goal/spec:** User-approved bounded catch-up of older callbacks with duplicate protection. No dependencies, widget activation, DeepSeek calls, real emails, or production verification writes.

**Architecture:** Standard SQL anti-join against the existing organization/source-key unique index selects at most 100 missing eligible completed calls, ordered by createdAt ASC, id ASC. Apply current lead access, matching lead/task identity, task owner, and completion checks before LIMIT. Retain canonical lead/task locks, fresh source/access checks, skipDuplicates and transactional rollback. An existing suggestion in any status or ownership excludes the source; existing pending-owner handoff stays separate and bounded. No new schema or checkpoint: committed suggestions are the progress record.

**Behavior/tradeoff:** First-page inbox reads catch up one batch. Refresh, existing polling, and Load more's contiguous root revalidation advance successive batches. Continuation reads create no additional callback suggestions, keeping page boundaries stable within each window. Large backlogs take multiple first-page reads; no worker or unbounded loop is introduced. Duplicate callbacks never reset approved/dismissed suggestions or overwrite drafts. No new leads/tasks, approvals, sends or AI work.

## Tasks

- [x] Task 1 RED: mocked selection regression for missing-only oldest-first bounded candidates, pre-limit access/task filtering, canonical source key, continuation no-create, committed progress across batches, duplicate/review preservation, stale-source skip. Run the narrow new test and observe failure before implementation.
- [x] Task 1 GREEN: change only callback candidate selection in listFollowUps; retain locks and final checks. Run affected follow-up suites without weakening assertions; ask before any incorrect-fixture corrections.
- [x] Task 2: disposable PostgreSQL drill with >200 completed callbacks, pre-existing reviewed sources, ineligible earlier calls, repeated roots/continuation, concurrent duplicate reads, source/task/access changes and rollback. No production data or provider use.
- [x] Task 3: full tests, lint, build, strict/fast checks after build, all 130 guarded browser scenarios; one fresh read-only review and one substantive RED→GREEN fix pass if needed.
- [ ] Task 4: prove reverse patch applies, merge/push authorized main, verify all CI jobs, exact-SHA deployment, anonymous denial and widget-off. Preserve unrelated files and managed checkout.

## Review focus

Every eligible older source eventually advances despite reviewed or malformed newer sources; invalid task/lead/access rows cannot consume the batch. Existing reviewed/draft content is never reset. Simultaneous readers and task reassignment cannot create duplicate work or assign a callback to the wrong owner. Continuation reads cannot shift the active page window by creating new callbacks. Partial transaction failure never records progress and permits safe retry.

## Verification

Passed 2,341 tests in 360 files, all 130 guarded browser scenarios, lint, production build, and strict/fast type checks after the build. The fresh whole-branch review found no actionable issues.

The isolated PostgreSQL 17 drill preserved 20 reviewed suggestions and caught up 205 missing callbacks in batches of 100, 100, and 5. It verified stable tied timestamps, 240 earlier ineligible sources, foreign-source exclusion, unchanged reviewed drafts, no creation on continuation, concurrent duplicate prevention, injected-failure rollback, safe retry, and ownership/lead-access checks. Every assertion remained intact through the approved fixture corrections. All 41 migrations and the existing privacy/DDL rollback checks passed; the owned test container was removed.

Rollback: revert this code-only commit to stop further catch-up. Valid follow-ups already created by normal inbox reads remain for review, preserving later draft edits and review decisions. No schema or destructive data undo is needed.

Live providers and real email delivery were not exercised. No dependencies, widget activation, schema changes, or production test writes were introduced. Large backlogs advance over multiple first-page reads through refresh, existing polling, or Load more revalidation.
