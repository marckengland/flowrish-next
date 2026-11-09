# Roll back send-result recovery

Before this change, production served `a94fd10aac76b7fc7eba538030586f13802f7cc1`. A read-only catalog check on 2026-11-09 found 44 applied migrations, no `FollowUpSendAttempt` table, PostgreSQL 170006, and zero enabled widgets. No secret values were read or changed.

If sending or status reads fail, pause follow-up writes and manual sending while retaining every attempt record. Restoring an unprotected old sender could resend an unknown or already accepted email. An accepted email cannot be recalled by rolling back code.

On a rollback branch from current main, capture the current HEAD before reverting the feature. Revert the new client recovery UI, capability wiring, drill and CI command. Keep the current schema, applied migration, backend tracking service, email send route, transport hooks, read-only status route, shared result schema, and their tests from that captured HEAD. Keep the anonymous status smoke check too. The tested rollback patch records these exact paths. This retains duplicate protection even if an old or cached browser submits again, and lets cached tabs check status without treating a missing endpoint as lost access.

Keep the optional server-only `FLOWRISH_FOLLOW_UP_WRITES_PAUSED` policy and set it to `true` for the rollback deployment. Its normal default is unset. The rollback build is verified with the setting enabled, and policy tests cover both modes. Revert the new drill and npm command together while retaining the existing release gate and other regression jobs. Run full verification and deploy through normal CI. This rollback pauses follow-up mutations and manual email; read-only CRM work and status checks remain available.

Keep the send table, HMAC key, operation IDs, request hashes, states and receipts. Deploy corrected tracking code before restoring writes. Never remove the backend guard while retained attempts exist. Unknown and confirmed records stay blocked. Do not delete, clear or mark an unknown record failed to make sending available.

The task evidence contains an exact rollback patch, inverse/reapply proof and a production build of that rollback tree. The disposable database drill verifies the retained table does not change baseline CRM rows and preserves the duplicate guard across membership changes. A rollback takes a normal tested deployment and cannot undo provider acceptance or recover a receipt that never reached Flowrish.

Do not drop the table, delete an applied migration, restore a whole production database, change the existing key, force-push main, or bypass the production gate. Do not promote the old unprotected deployment directly.
