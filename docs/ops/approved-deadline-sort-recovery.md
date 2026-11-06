# Recover Approved deadline sorting

Baseline: `26f20a29dfb3dec98768fdf7647ed7947886f693`.

This feature adds no dependencies or migrations. Newest follow-ups remains the default. Earliest task deadline sorts authorized dates ascending, then follow-up creation descending and ID ascending. Unavailable tasks appear last. Approved reads do not materialize callbacks or change tasks, sources, or emails.

Sorted page cursors include a fingerprint of the complete matching set. A changed deadline or matching record returns `409 FOLLOW_UP_ORDER_CHANGED`. Refresh the list and retry; the inbox retains unsent drafts. This consistency check adds read work; production-volume performance has not been benchmarked.

Saved views may contain `filters.taskOrder: DUE_ASC`. Older strict readers need the compatibility guard below. Keep the stored settings so the view returns when sorting support is restored. Never remove the field and silently widen the view.

Before reverting, copy the compatibility patch outside the checkout. Revert the feature and apply the guard to the baseline reader:

```sh
cp docs/recovery/approved-deadline-sort-legacy-views.patch /tmp/flowrish-deadline-sort-compat.patch
git revert --no-commit <deadline-sort-commit>
git apply --index /tmp/flowrish-deadline-sort-compat.patch
```

Review the resulting diff, run the configured checks, and deploy through the normal release gate. Existing progress views remain readable; order-specific views are hidden before strict decoding. A code deployment is required for recovery.

The synthetic PostgreSQL drill verifies all 225 sorted rows across three pages, equal deadlines, unavailable task privacy, retained drafts outside the page, filter intersection, manager scope, foreign-business denial, and deadline changes between and during reads. It compares task, lead, source, activity, and audit snapshots exactly. It also runs the baseline reader and strict saved-view schemas with the compatibility guard and checks that stored JSON is unchanged.

Before shipping, verify that reversing the staged feature reconstructs the exact baseline tree, reapplying reconstructs the feature tree, and reversing plus the guard produces only the documented baseline reader change.

Do not delete saved views, alter task data or applied migrations, weaken permissions, enable the widget, or contact AI/email providers during recovery. Live provider behavior and production-volume performance are outside this verification.
