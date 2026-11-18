# Staff waitlist access and rollback

The public waitlist is global. Customer organization permissions do not authorize reads. `WaitlistStaffAccess` grants one live `OrganizationMember` access in that membership's organization. There is no app API for granting access. Staff also need current organization-scoped `leads:read` and `leads:write` permissions to prepare or confirm CRM handoff.

## Provision access

An operator must verify the intended organization, user, and exact membership before creating a grant. Use the authenticated user's immutable application ID, not an email domain, display name, or editable profile claim. Record whether the grant existed before making any change. Grant only that verified membership; never grant all administrators.

```sql
SELECT m.id, m."userId", m."organizationId", o.name
FROM "OrganizationMember" m
JOIN "Organization" o ON o.id = m."organizationId"
WHERE m.id = :membership_id;

INSERT INTO "WaitlistStaffAccess" ("membershipId")
SELECT id FROM "OrganizationMember"
WHERE id = :membership_id
  AND "userId" = :verified_user_id
  AND "organizationId" = :verified_organization_id
ON CONFLICT ("membershipId") DO NOTHING;
```

Use bound parameters through the operator's database client. Verify the grant with a read-only query afterward. Authorized staff open **Admin → Flowrish waitlist inbox**, or `/staff/waitlist`. Staff without access to the Admin navigation can use that direct path. No prospect data should be copied into an access ticket or migration.

## Disable access or roll back the feature

The release adds nullable/defaulted review fields, a private grant table, and private durable CRM receipts. It does not backfill prospect details, rewrite invitation status, enable the widget, or contact a provider.

1. To revoke a grant introduced by this release, delete only its recorded membership ID. Do not remove a pre-existing grant. Repeating this exact delete is harmless; other staff grants remain untouched. Removing an organization membership also removes its grant.
2. Revert the feature code through the normal deployment process while retaining the additive Prisma schema and both new migrations. Keep the Library GIN index declaration and restoration migration too.
3. Verify denied staff APIs return no data, the old waitlist capture remains available, and the widget remains off.

```sql
DELETE FROM "WaitlistStaffAccess" WHERE "membershipId" = :introduced_membership_id;
```

For a release committed as one ordinary commit, prepare the code rollback locally:

```sh
git revert --no-commit <staff-waitlist-release-commit>
git restore --source=HEAD --staged --worktree -- AGENTS.md prisma/schema.prisma prisma/migrations/20261104000000_preserve_knowledge_search_index/migration.sql prisma/migrations/20261104010000_add_staff_waitlist_inbox/migration.sql
```

Review and test that change before committing/pushing it. Recovery takes one normal deployment. Retaining fields and receipts is compatible with the prior application and prevents a future retry from duplicating an approved handoff. Keep private-table RLS and browser-role revocations in place.

The receipt foreign key restricts destination-organization deletion, so retirement must explicitly preserve or handle receipts first. This protects deduplication after lead removal.

A rollback cannot undo staff-approved CRM work or subsequent edits. Review those leads individually through CRM. Do not drop receipt tables, edit applied migrations, bulk-delete prospect/CRM records, restore the full database, or force-push history.

## Verification

Unit tests cover exact membership grants, tenant switching, bounded reads, versioned reviews, scoped CRM choices, preview freshness, duplicate acknowledgement, retries, and missing CRM targets. Route and page tests cover unauthenticated/ungranted access and same-origin writes. Mocked desktop/mobile browser workflows cover demo attribution, review, editing/approval reset, explicit matching, denied/revoked access, and uncertain confirmations.

`scripts/staff-waitlist.integration.test.ts` runs separately with `vitest.waitlist.config.ts` against a disposable loopback PostgreSQL database. It refuses absent/non-loopback URLs and requires the dummy `postgres` / `mock-only` identity. It verifies transactions, concurrent confirmations, rollback after a receipt failure, grants/revocation, RLS and browser-role denial. It must never target production.

The repository's `prisma.config.ts` loads `.env` with override enabled. Shell datasource variables alone do not isolate Prisma CLI commands. Local verification uses a copied schema with literal dummy loopback URLs, an explicit config outside the repository, offline `migrate diff --from-empty --to-schema-datamodel ... --script`, then `docker exec psql` inside the owned disposable container. Never use `prisma db push` for test setup.

Apply reviewed migrations before application promotion, and verify that schema-drift repair preserves the Library GIN search index and follow-up indexes. Keep incident details and operational readbacks outside public source.
