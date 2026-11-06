# Recover Approved task progress

Baseline application: `0ad9e7c4c54186377aa4f8b167604e4714c01461`.

This feature adds no dependencies or migrations. Progress reads return minimal metadata from currently authorized linked tasks. Open includes all unfinished tasks; Overdue is unfinished and due before the server check time. Approved progress reads skip callback materialization and do not edit tasks or sources.

If the feature fails, revert its application commit while retaining saved view JSON. Before reverting, copy `docs/recovery/approved-task-progress-legacy-views.patch` outside the checkout. After the revert, apply that patch to the baseline saved-view reader:

```sh
cp docs/recovery/approved-task-progress-legacy-views.patch /tmp/flowrish-approved-progress-compat.patch
git revert --no-commit <approved-task-progress-commit>
git apply --index /tmp/flowrish-approved-progress-compat.patch
```

The small compatibility guard hides progress-specific views from older clients before their strict schemas parse them. Other views remain available. The stored progress-specific views are retained and return when support is restored; they are never silently widened to All tasks. Review and run the configured checks, then commit and deploy through the release gate. Recovery takes a normal code deployment.

Before shipping, prove the inverse plus compatibility patch produces exactly the baseline tree with only this saved-view guard changed. In disposable PostgreSQL, run the baseline reader and baseline strict filter/view schemas with the guard against synthetic saved progress views; verify ordinary views remain readable and every saved row is unchanged.

Do not delete saved views or task data, strip filters from user JSON, edit applied migrations, restore the whole database, weaken task/lead access, enable the widget, or call an AI/email provider to diagnose this feature. Progress edits and reassignment remain in CRM. Paging reflects current reads rather than a transaction spanning the user's session.
