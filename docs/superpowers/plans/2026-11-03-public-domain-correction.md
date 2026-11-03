# Public domain correction

Use inline execution and one independent review before merge. Baseline d23d588. User authorized replacing the unowned domain, removing fake sales email references, mocked verification and merge/release as needed. Widget stays off; do not call DeepSeek or other providers.

- [x] Add failing coverage for canonical/default and legacy-override URLs, metadata/sitemap/robots, both landing modes, sales CTA removal, onboarding and mobile layout. Implement through the shared site address, preserving future explicit domain overrides and existing signup behavior. Add no dependencies and change no existing tests.
- [x] Update the decorative app address and setup documentation. Remove email-only demo links; render Enterprise sales action only when a destination is explicitly supplied. Keep published pricing/trial copy outside this requested correction.
- [x] Run focused and full tests, formatter/lint, strict/fast types, guarded build and anonymous desktop/mobile browser checks with all mutations/provider requests blocked. Verify current widget off and data/usage unchanged through read-only metadata.
- [ ] One fresh independent review and regression fixes as needed. Prove exact-code rollback in a temporary index, commit/merge, verify merged checks, push and verify CI/deployment plus deployed browser checks.

Rollback: code revert only; no schema, credentials, deployment environment or persistent business settings changes. A revert restores the obsolete public references, so prefer a targeted correction if the layout needs repair.

Tradeoff: preserving explicit future site URL overrides means public identity still depends on deployment configuration. Known obsolete brand-domain overrides must resolve to the current domain so a stale setting cannot revive an unowned address.
