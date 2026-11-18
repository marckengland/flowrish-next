# Recover contact preference enforcement

If contact restrictions cannot be verified, keep outreach blocked. Do not redeploy the older unrestricted sender, clear restrictions in SQL, drop the registry, or resume stopped cadences as an availability fix.

## Migration compatibility

Migration `20261105060000_add_contact_suppressions` creates one private additive table with a workspace/address unique key, normalization/reason/revision constraints, organization foreign key, RLS, and revoked public/browser grants. It performs no business-data backfill or deletion. The table and recorded migration must remain through recovery.

## Fail-closed pause

Use an isolated recovery branch from the release. Apply and review the one-line pause:

```sh
git apply --check docs/recovery/pause-contact-policy.patch
git apply docs/recovery/pause-contact-policy.patch
```

`contactPolicyAvailable()` now returns false. New contact changes, enrollment/bulk/resume operations, local cadence effects, and lead email delivery reject with `CONTACT_POLICY_PAUSED`. Existing registry rows, audit entries, and exited enrollments remain intact. Authorized preference reads remain available. Sending a preview to the mailbox owner is a separate existing workflow; this switch is not an organization-wide transport kill switch.

Run repository checks, commit the reviewed pause, and deploy through the normal release pipeline. No database rollback, dependency change, or secret change is required. Do not cancel an active production migration to hurry recovery.

Fix the underlying problem using mocks and disposable data. Reverse only the pause after verification:

```sh
git apply --reverse --check docs/recovery/pause-contact-policy.patch
git apply --reverse docs/recovery/pause-contact-policy.patch
```

Review, run checks, and deploy normally. Preserve all suppression rows and every authorization and recipient check. Resume decisions still require their normal explicit workflow.

## Local recovery proof

The patch was applied to the implementation and reverse applicability checked. A network-blocked harness called nine actual service boundaries: contact authorization, preference clearing, the enrollment transaction, single/bulk enrollment, resume, lead email sending, queued-cadence suppression, and local cadence effects. All returned the paused error with zero database writes and zero network calls. The sender performed one synthetic lead read. The enabled policy was restored byte for byte afterward.

The PostgreSQL 17 drill applied all 40 migrations, injected and rolled back a failing final DDL transaction, then verified revoked default browser grants, constraints, duplicate/archive/tenant separation, a real reviewed merge, block/enrollment races in both orders, audit-wait rollback, local task serialization, cached-stage denial, and the concurrent pause race. The owned database container was removed. Already accepted email/provider operations cannot be recalled; these drills do not use real delivery or measure deployment time.

The reviewed feature tree passed 2,270 tests across 342 files, lint without warnings, a production build, both strict and fast TypeScript checks, and 106 mocked browser scenarios retaining the original 100 scenarios and every guard. Desktop and 390px screenshots were inspected. Three material review findings were reproduced and fixed: provider-selected Outlook recipients, local/cached cadence effects after blocking, and a pause overwriting EXITED. Live provider testing, phone/SMS controls, and production business-data verification writes were excluded.
