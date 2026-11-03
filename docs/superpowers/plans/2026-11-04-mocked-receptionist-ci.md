# Mocked receptionist browser CI

> Execute inline; one independent final review before merge.

**Goal:** Run the existing 17 browser scenarios without production credentials, authentication, database access, provider calls, emails, or real writes.

**Architecture:** A separate Next.js fixture application imports the real client components. It has synthetic read endpoints, no production middleware or backend imports, and rejects unmocked mutations. A runner supplies a clean environment, restricts server sockets, proxies browser traffic through a loopback-only read proxy, and fails on guard violations. The normal application has no test login mode.

**Constraints:** No dependency changes. Preserve the existing scenario assertions. Keep the production widget off. Do not use DeepSeek or create real leads or send emails. Use only the existing Node/Next/Playwright toolchain.

- [x] Add and verify network policy, clean-environment handling, and negative guard probes.
- [x] Add the isolated fixture pages and Playwright configuration. Run exactly 17 scenarios with no auth setup, no storage state, no retries, and no skipped cases.
- [x] Add one npm command, parallel CI job, and instructions. Local browser/guard tests, full unit tests, lint/types, normal application build and independent review completed.

Release verification: prove code rollback, check the merged tree, push, and verify both CI jobs and deployment before reporting completion. Results are recorded in the delivery report.

Review focus: external and alternate loopback destinations; swallowed guard errors; accidentally imported production server modules or environment files; unchanged scenario coverage; failed-process cleanup and exit codes.

Tradeoff: these fixtures exercise client workflows, not production authentication or database transactions. The existing backend tests retain that separate responsibility. Adding browser scenarios requires updating the explicit suite manifest and count.

Review: no Critical/Important findings. The cleanup minor was fixed with a bounded SIGTERM/SIGKILL shutdown and a passing child-process regression probe. Production authentication/database behavior and hostile native-code bypasses remain outside this client-workflow fixture.
