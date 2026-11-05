# Saved follow-up views

Save a personal named snapshot of the applied inbox tab, search, source and due-reminder filter. Scope records to the authenticated user and workspace. Explicitly apply a selected snapshot through the existing unsent-draft guard; remote changes never automatically navigate or replace an open draft. No provider calls, mail, dependencies or widget changes.

1. Add strict contracts and a private additive SavedFollowUpView table. Use membership locks, a 20-view limit, idempotent create identifiers and revision-checked updates/deletes. Test scope, limits, conflicts, errors and HTTP identity/origin/body guards.
2. Add accessible saved-view controls, manual/focus synchronization, explicit apply, conflict reload and uncertain-save recovery. Keep filters and drafts during CRUD. Test current permissions, stale responses, account switches and keyboard/mobile behavior.
3. Extend guarded browser coverage after fixture approval. Run the complete mock suite, lint, production build, then both type checks. Exercise migrations, real services, concurrency and additive-schema rollback compatibility on isolated PostgreSQL with synthetic rows only.
4. Obtain one fresh whole-branch review, fix confirmed defects, verify and integrate. Check exact-commit CI/deployment and anonymous privacy/widget state without authenticated production writes.

Prior art: private saved searches with optimistic concurrency, matching saved lead views. A separate table protects existing lead-view contracts. This does not provide shared team views; adding sharing later requires a separate permissions design.

Rollback: revert this release's code and retain the additive private table and its data. Never drop the table, rewrite applied migrations, or restore a whole production database to undo this feature.
