# Open-source readiness

Preparation snapshot: November 16, 2026. This document is a review record, not a guarantee that no secret or third-party rights issue exists.

## Prepared changes

- Added the MIT license, package license metadata, contributor guidance, security reporting policy, and third-party notices. npm’s `private` flag remains enabled to prevent accidental npm publication.
- Ignored local Serena and Spec Workflow state in addition to existing environment, authentication, build, and browser-artifact exclusions.
- Corrected the example environment’s obsolete domain comment and the quick-start migration command. New installations apply existing migrations to their own database.
- Restricted migration, production-ready, and production-smoke jobs to the maintainer repository. Forks still run unit, browser, and synthetic database checks; they do not deploy to Flowrish’s services.

## Audit evidence

The repository had 331 commits across the local refs and 3,480 distinct file blobs. A pattern scan covered approximately 35.9 MB of historical file content and found no unclassified high-confidence provider keys, GitHub tokens, private keys, AWS access identifiers, or credential-bearing database URLs. A second assignment scan found 23 high-entropy occurrences, all in deterministic encryption/environment test fixtures across three test paths. No tracked environment variants, browser authentication stores, or private-key paths were found in the inspected history.

The Actions inventory contained 221 runs. Available logs for 162 runs were scanned across 1,045 entries, approximately 50.2 MB, with no unclassified credential-pattern findings. Logs for 59 runs were expired or unavailable and could not be inspected. No Actions artifacts were listed. This is a pattern scan, not a full semantic review of every historical line or binary asset; do not infer that an unrecognized credential format is safe.

The dependency lockfile declares optional Sharp/libvips LGPL binaries and other non-MIT licenses. These do not become MIT when Flowrish receives an MIT license. Preserve upstream notices and review binary/container distribution obligations separately; see [third-party notices](../THIRD_PARTY_NOTICES.md).

Existing production repository names, project identifiers, public hostnames and certificate fingerprints remain in deployment and recovery helpers because they enforce the intended release target. They are public identifiers, not credentials. Removing those checks would weaken deployment isolation. Forks must provision their own deployment and review their own allowed targets.

## Owner review before publication

1. Confirm you own or have permission to release the application code, documentation and logo assets under MIT. Review contribution provenance; a package-license inventory cannot establish ownership of custom assets.
2. Review the source and available historical Actions logs for private business information beyond credential patterns. Expired/unavailable logs and arbitrary binary content were not fully inspected.
3. Confirm that publishing the full Git history, commit author metadata, deployment/recovery documentation and Actions history is intended. Removing a file from the latest commit does not hide its historical versions.
4. Enable GitHub private vulnerability reporting when public, review Actions permissions for outside contributors, and check Vercel’s fork-preview approval and secret policies before accepting external pull requests.
5. Make the reviewed repository public only after that approval. Do not disable release gates to avoid the private-repository Actions quota.

Standard GitHub-hosted runner compute is free for public repositories. Larger runners and storage have separate billing rules; changing visibility does not erase past charges or reset another private repository’s usage. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Publishing also makes Actions history and logs public; see [visibility consequences](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).

## Live AI check

Six OpenAI provider requests on `gpt-6.1-sol` completed successfully within the authorized eight-request ceiling. Three browser conversations exercised supplied tables/bar charts, missing-data honesty and approved pricing/hours, then a signed/fractional line chart and a two-sentence email draft. Exact values were preserved and no proposed CRM action was executed. The existing daily reservation allowance was nearly reached, so no further requests or live receptionist extraction were attempted. No limit was raised. The tests did not call DeepSeek, send email, enable reception, or create leads/tasks.

Live inspection found duplicate display of knowledge provenance. The display fix hides the raw footer only when a separate structured reference list exists; persisted provenance and history safeguards remain intact. Mocked checks cover both current replies and restored history without spending further provider requests.
