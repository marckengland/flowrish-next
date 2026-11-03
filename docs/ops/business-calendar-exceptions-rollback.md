# Recover business calendar exceptions

Wrong callback acceptance, incorrect business-minute deadlines, or persistent review warnings are reasons to stop calendar changes and investigate. Keep the website widget and phone reception off while verifying timing. Do not change saved callback times automatically or delete date overrides to hide a failure.

This release changes code and JSON contracts, with no database migration, grants, policies, credentials, or production settings changes. Before release on 2026-11-03, both organizations had no callbacks, handoffs, website sessions, enabled widgets, response policies, or date overrides. Control Flow Labs had no saved business profile; Flowrish retained Asia/Manila weekly hours.

The safe recovery for an editor regression is to deploy the parked `freeze-calendar-editors.patch`. It removes the new editing controls from guided setup and receptionist Settings while retaining calendar readers, callback validation, policy summaries and deadline calculation. Existing overrides stay enforced. Existing clients that omit overrides still retain them. The temporary-index proof and disposable tests verify this recovery without production writes. Patches and execution evidence are parked at `/Users/maki/.codex/flowrish-recovery/2026-11-03-business-calendar-exceptions/`.

A complete application revert to `15f6627` is safe only while the `calendarExceptions` key is absent from both business settings and response-policy snapshots. Even an empty array is incompatible with the older strict response-policy reader. Older response-policy readers reject the new JSON shape, and older callback validators ignore date exceptions. Check the following read-only counts before considering a full revert:

```sql
SELECT
  (SELECT count(*) FROM "ReceptionistConfig"
   WHERE settings ? 'calendarExceptions') AS business_calendars,
  (SELECT count(*) FROM "CallbackResponsePolicy"
   WHERE hours ? 'calendarExceptions') AS policy_calendars;
```

If either count is nonzero, use the calendar-aware editor freeze and repair the affected logic. Do not deploy calendar-unaware code against those records. A calculation regression requires a verified code fix; freezing the editor alone does not repair already calculated response targets. Keep reception off, preserve policy snapshots, and use the normal reviewed policy update/reconciliation after the fix. No recovery step should reschedule CRM tasks silently.

Recovery takes one deployment cycle after its checks pass. Never restore a whole database, erase timing snapshots, overwrite provider keys, enable reception to test recovery, or rewrite migration history. Automatic holiday import, recurring closures, split or overnight hours, staff capacity, external calendars and live calls remain outside this release.
