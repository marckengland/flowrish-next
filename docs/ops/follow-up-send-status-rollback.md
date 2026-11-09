# Roll back card send status

Before this release, production served `9489e33d899e0c39fb32bfaf421fdd6e93587424` with 45 applied migrations and zero enabled widgets. A read-only catalog check found zero saved views using Needs checking; no saved-view contents were read. Existing send receipts and duplicate protection must remain intact.

Saved follow-up views may now contain `filters.needsChecking`. Reverting every file would make the old strict reader reject those saved views. The tested rollback retains the additive filter parser and rejects Needs checking list/count requests with a visible unavailable error. Users can clear that filter and continue. It does not delete or rewrite saved views, silently return unfiltered matches, or change send outcomes.

Use the parked rollback branch or exact tested patch recorded in the verification evidence. Its runtime is based on the previous release, with the compatible parser and fail-closed guards in `listFollowUps()` and `readFollowUpCounts()`. It removes new card badges and status checks while leaving the prior composer recovery and all backend duplicate guards unchanged. A new rollback test checks saved-view readability and rejection before database access. The rollback tree is built and tested before release.

For a later rollback, start from current main and review the patch against intervening changes. Preserve the current schema, applied migrations, send ledger and encryption key. Run the full checks and deploy through normal CI. A rollback takes a normal tested deployment; it cannot undo provider acceptance or resolve an unknown send.

Do not drop or reset the send table, delete draft or saved-view records, remove applied migrations, restore a whole production database, force-push main, or bypass the release gate. Do not remove the existing send-result guards to make an unknown retry available.
