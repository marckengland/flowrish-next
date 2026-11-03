# Roll back preferred callback times

This release adds nullable `preferredTime` snapshots to website callback requests and CRM handoff receipts, and a nullable `callbackRequestHash` to website sessions. It changes no existing rows, grants, policies, provider settings, or website switch values.

If timing validation or the new controls fail after deployment, keep website reception disabled and roll back the application change. Retain the Prisma model fields and `20261103080000_add_preferred_callback_time` migration in source control. Leave the columns, their stored values, and both migration histories in place. Do not run a reverse migration that drops requested times or retry hashes.

Before reverting, record counts of non-null preference snapshots and submission hashes. Deploy the application revert with the additive schema files retained, then confirm the same metadata counts and that the website switch is still off. Do not process handoffs, reschedule, or delete sources for timed requests using the old interface. Those records remain available for review when time-aware code returns. Existing CRM tasks retain their approved deadlines.

The disposable PostgreSQL tests apply the migration to a database containing a legacy callback, compare the legacy row and table privileges before and after, then exercise timed handoff/rescheduling. Legacy-field updates preserve the new snapshots and submission hash. Source deletion preserves the handoff snapshot. Untimed callbacks retain their previous deadline and first-contact target rules. Repeated migration application is not an undo mechanism.

Do not restore a whole database backup, edit an applied migration, change API credentials, enable the widget to test recovery, or recreate callbacks/tasks that were removed. Real provider requests and production test records are unnecessary for verification. Code rollback uses the normal deployment process; there is no database data-restore step.

Weekly opening hours do not model holidays, staff capacity, overnight shifts, or an external appointment calendar. A requested time requires staff confirmation and does not reserve an appointment.
