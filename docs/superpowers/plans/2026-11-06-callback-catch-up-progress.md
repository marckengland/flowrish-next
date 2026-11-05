# Callback catch-up progress implementation plan

> Use superpowers:executing-plans inline, TDD, and one fresh whole-branch review.

**Goal/spec:** User-approved callback backlog status and Continue catch-up, preserving filters and unsent drafts. No new dependencies, widget activation, DeepSeek calls, real emails, or production verification writes.

**Architecture:** Optional root-page metadata reports actual created count (0–100) and a fresh, authorization-scoped existence check for remaining eligible callbacks. Reuse the candidate anti-join with LIMIT 1; no total count or schema change. Continuations omit catch-up metadata and never materialize work. Legacy unpaged payloads and older paged fixtures remain supported. The reader retains root metadata across continuations, with existing scope, access-version, and retained-draft fences.

**Client:** A named Callback catch-up region above the list shows last confirmed check count, remaining-work status, and Continue catch-up. One click revalidates the loaded window from its root at the same depth, preserving filter state and keyed composers. Existing abort/epoch/identity guards apply. Separate catch-up loading/retry labels use the existing page request controller; no overlap or automatic error retry. Lost responses retain the last confirmed receipt; explicit retry relies on source-key idempotency. Access changes clear cached progress and private work.

**Tradeoff:** One extra bounded-result read on each paged root. Progress describes the last confirmed check, not a cumulative or exact cross-device backlog count. All accessible callbacks are checked even when current list filters hide them; explain this in the UI. Background workers and new protocol endpoints are outside scope.

## Tasks

- [x] Server RED→GREEN: created counts, scoped remaining-work query with LIMIT 1, no legacy/continuation metadata, existing source uniqueness/locks/final permission check retained.
- [x] Reader/UI RED→GREEN: retain root receipt, legacy compatibility, valid metadata bounds, preserve filters/draft DOM, loading/duplicate-click guard, transient error and explicit retry, stale filters/account/epoch, empty/read-only/completed status.
- [x] Six mocked browser cases and approved 130→136 guard extension, retaining all existing scenarios and guards. Disposable PostgreSQL drill verifies metadata against real 100/100/5 batches, ownership, rollback, retry and concurrency; no real provider/data use.
- [x] Full tests/lint/build/postbuild strict/fast, browser rehearsal, fresh whole-branch review and one substantive regression-driven fix pass if needed.
- [ ] Reverse-patch proof, authorized merge/push, all CI jobs and exact-SHA production verification, anonymous denial and widget-off. Preserve managed checkout and unrelated files.

## Review focus

Progress must never disclose another workspace/user's backlog, survive stale account responses, or claim unconfirmed cumulative work. Continuation receipts must not overwrite the root receipt. Continue and retry must preserve mounted drafts and filters through overlapping, delayed or failed requests, and must never auto-send or approve. Fresh remaining-work checks use the final lead scope and are followed by the final permission check. Empty filtered results and read-only users must still see honest global callback scope and completion status.

## Verification and rollback

Passed 2,351 tests in 363 files, lint, production build, both post-build type checks, and all 136 guarded browser scenarios. All 130 existing scenarios and every network/write guard remain. Desktop/mobile checks cover filters, mounted drafts, explicit retry, delayed responses, stale account denial, empty/read-only results, and keyboard activation. The mobile screenshot was visually inspected.

The fresh whole-branch review found one retry race when a composer opens during a failing request. A new regression failed before the fix and passed after it; the full suite then passed. Failed active reads pause automatic retry while preserving new draft edits.

The disposable PostgreSQL 17 drill verified actual progress counts of 100, 100, 5, and 0, correct remaining-work flags, no continuation receipt, and concurrent receipt counts matching actual claims. All prior assertions for 225 callbacks, 20 reviewed suggestions, 240 ineligible sources, ownership, unique claims, transaction rollback, and safe retry remain and passed. All 41 migrations/privacy checks passed and the owned container was removed.

Rollback is a normal code revert; valid follow-ups already created by inbox reads remain, preserving later draft edits and review decisions. No dependencies, schema changes, widget activation, or production test writes were introduced. Live providers and email delivery were not exercised. Progress describes the last confirmed check rather than a cumulative cross-device total.
