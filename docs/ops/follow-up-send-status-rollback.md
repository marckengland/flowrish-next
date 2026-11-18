# Roll back card send status

Saved follow-up views may now contain `filters.needsChecking`. Reverting every file would make the old strict reader reject those saved views. The tested rollback retains the additive filter parser and rejects Needs checking list/count requests with a visible unavailable error. Users can clear that filter and continue. It does not delete or rewrite saved views, silently return unfiltered matches, or change send outcomes.

Prepare a selective rollback against your current release, retaining the compatible parser and fail-closed guards in `listFollowUps()` and `readFollowUpCounts()`. Remove card badges and status checks only while preserving composer recovery and all backend duplicate guards. Add a recovery regression for saved-view readability and rejection before database access, then build and test the recovery tree. This procedure does not require an unpublished branch or patch.

For a later rollback, start from current main and review the patch against intervening changes. Preserve the current schema, applied migrations, send ledger and encryption key. Run the full checks and deploy through normal CI. A rollback takes a normal tested deployment; it cannot undo provider acceptance or resolve an unknown send.

Do not drop or reset the send table, delete draft or saved-view records, remove applied migrations, restore a whole production database, force-push main, or bypass the release gate. Do not remove the existing send-result guards to make an unknown retry available.
