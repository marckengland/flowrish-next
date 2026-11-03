# Visitor feedback rollback

Before release, production main was `8c699358353a3989e93a028db15cc2884e32a068`. Read-only checks on 2026-11-03 found no `WebsiteReceptionistFeedback` table, zero widget configurations/enabled widgets, zero Library documents and zero callback requests. The latest applied Prisma migration was `20261103060000_add_callback_response_targets`.

Migration `20261103070000_add_visitor_feedback` adds a default-false configuration flag, an opaque nullable session receipt ID, and private feedback/daily-counter tables with RLS and revoked PUBLIC/anon/authenticated privileges. The text-free daily counter survives report deletion and is purged after two UTC days. It performs no backfill, opt-in, provider change, publication, CRM write, or customer-data rewrite.

If feedback saving, admin review or draft creation malfunctions, disable the application feature through a normal deployment. Keep the additive schema, retained feedback and the expiry job so previously consented question text continues to be purged:

```sh
git log --oneline --first-parent --grep='Merge visitor feedback to FAQ drafts'
git revert --no-commit -m 1 <merge-commit-from-the-log>
git restore --source=HEAD --staged --worktree -- prisma/schema.prisma prisma/migrations/20261103070000_add_visitor_feedback/migration.sql src/lib/visitor-feedback-retention.ts src/server/services/visitor-feedback-retention.ts src/server/inngest/website-receptionist-cleanup.ts src/server/inngest/__tests__/visitor-feedback-cleanup.test.ts
git commit -m 'Disable visitor feedback while preserving expiry'
```

The old session flow does not advertise feedback, and the public/admin feedback routes disappear. The existing daily cleanup keeps its new private-table expiry step. FAQ drafts explicitly created by administrators remain in Library with their existing publication and receptionist approval states. Recovery takes one normal deployment; it does not retract a document someone independently published.

Do not drop the feedback table, delete drafts, disable expiry, edit/delete an applied migration, force-push or restore a database snapshot. No secret value belongs in rollback notes or SQL logs.

The disposable database suite verifies opt-in defaults, private roles, tenant/session binding, replay/concurrent limits, shared Library caps, source expiry, draft retention and repeated purge. A temporary Git index verifies that reverting the feature and restoring these six paths leaves exactly the baseline application plus additive schema and the expiry implementation. The recovery tree must typecheck and run its retained cleanup test before deployment.

## Release evidence

The additive migration was applied with Prisma checksum `6220c2d6f822427ec27a81b7ce6c4719fa79d509846f16e037812d26a3259486`. Both new tables have RLS enabled; anon/authenticated SELECT/INSERT/UPDATE/DELETE privileges are false. Supabase reports the expected “RLS enabled, no policies” informational notice for these intentionally private tables; [API grants and RLS documentation](https://supabase.com/docs/guides/api/securing-your-api) describes this access boundary. No browser policy should be added to resolve that notice.

After migration, feedback, daily counters, feedback opt-ins, enabled widgets, Library documents and callbacks were all zero. A temporary recovery tree differing from baseline only in the six retained paths passed strict TypeScript and its retained cleanup test; its tree was `36dbe2a26ce797e507935ba7028529afea250d78`.
