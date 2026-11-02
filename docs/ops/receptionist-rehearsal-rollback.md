# Receptionist rehearsal reports rollback

The release adds an isolated table and explicit report actions. No customer records are migrated or changed.

## Before release

On 2026-11-02, production main was `b37cebe720bb6f4176f8b3362fc655dc7913200f`. A read-only schema query confirmed that `ReceptionistRehearsal` was absent and that `ReceptionistCall` and `Organization` existed. The latest applied Prisma migration was `20261102091000_add_org_ai_provider`. There were no open pull requests with a competing migration version.

## Recover

If report operations fail after deployment, revert the feature merge and deploy the revert:

```sh
git log --oneline --first-parent --grep='Merge receptionist rehearsal reports'
git revert -m 1 <merge-commit-from-the-log>
```

Leave `ReceptionistRehearsal` and its migration record in place. The old code does not use this additive table. Saved rehearsals remain recoverable, with RLS enabled and public/browser-role access revoked. Recovery takes one normal deployment, typically several minutes.

This does not restore a rehearsal that an admin explicitly deleted. It also does not undo provider calls a user independently chose to make. Verification for this release uses mocks and makes no provider calls.

Do not drop the table, delete stored reports, edit the applied migration, force-push main, or restore a full database snapshot to disable this feature.

## Evidence

- Disposable PostgreSQL applies all migrations, checks RLS and revoked SELECT/INSERT/UPDATE/DELETE privileges, and saves distinct reports for two synthetic organizations.
- Concurrent retries produce one immutable snapshot per organization/client ID. Cross-organization reads, reviews, and deletes fail. Stale review versions fail. A former member loses access.
- Report operations leave lead, task, activity, receptionist-call, audit, and receptionist-configuration counts unchanged. The provider transport mock receives no requests.
- A temporary Git index reverses the full staged feature diff and returns exactly to the base tree. The working tree and migration data are not changed by that check.
