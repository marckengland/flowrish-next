# Maintain dependency security

Use Node.js 22 and the committed npm lockfile. Review security updates on a branch, install with `npm ci`, and run the [development checks](TESTING.md#run-the-full-development-checks). Do not use `npm audit fix --force` without reviewing the proposed major changes or downgrades.

## Check runtime and development dependencies

```sh
npm audit --omit=dev --audit-level=high
npm audit --json
npm ls --all
```

The first command rejects critical/high findings in the production dependency tree. The full audit also includes build, lint, test, and code-generation tools. A finding inherited by several parent packages can represent one underlying advisory. Neither a passing test suite nor an empty audit proves that the application has no security defects.

CI runs the production critical/high gate and a full-tree critical gate. The full audit's high findings still need review against the specific tooling exception below. That exception does not approve unrelated future advisories.

`shadcn` is a development dependency. Its CLI generates source components, and the build imports `shadcn/tailwind.css`. Install development dependencies before building. The running app uses the compiled CSS and checked-in components without importing the CLI.

## Review the compatibility overrides

| Override | Reason | Check before removing it |
|----------|--------|--------------------------|
| `zod` → root version | Keep the patched package throughout the graph | Confirm that application schemas use the patched API and SDK compatibility imports still work |
| `@prisma/config` → `deepmerge-ts` 8.0.2 | Fix recursive-object handling while retaining Prisma 6 | Run offline config/schema generation and disposable database checks; version 8 changes Map merging |
| `next` → `postcss` 8.5.33 | Replace Next 15's pinned parser with the patched version | Run the production build and mocked browser build |
| `vitest` → `tinypool` 2.2.0 | Fix worker-option prototype-pollution handling | Run the full suite under Node 22, including subprocess tests |
| `@opentelemetry/propagator-jaeger` → 2.9.0 | Use its security fix with the retained telemetry API generation | Check telemetry peer ranges before choosing a later version |
| `@opentelemetry/otlp-transformer` → `protobufjs` 8.8.1 | Replace a pinned vulnerable serializer | Run worker and transport compatibility checks |

The Inngest SDK uses Zod's legacy compatibility entry point for its own schemas. Application request validation uses the patched main API. A package-wide version override does not mean every bundled legacy API acquired the same fixes. In the retained SDK, the constrained legacy array holds developer-owned concurrency configuration; cloud execution parsing follows signature validation. Recheck those boundaries when changing the SDK or exposing development mode.

## Unpatched development-tool finding

As of November 18, 2026, [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) affects the published Picomatch versions, including latest 4.0.7. The advisory reports excessive regular-expression backtracking for attacker-controlled repeated-extglob patterns. There is no published patched version to select.

The remaining high findings in this dependency update inherit that advisory through development tools. The production dependency audit excludes those paths after moving the unused runtime CLI to development dependencies. Application source does not import Picomatch or accept glob patterns for these tools; patterns come from repository configuration and developer commands.

The maintainer accepted this development-tool exception on November 18, 2026. The parser finding remains unresolved. Keep untrusted patterns out of local tooling and review changes to build/test configuration before running them with privileged credentials. Do not rename a vulnerable package, suppress the advisory globally, or claim that moving a tool fixes its parser. Recheck the upstream advisory and replace this exception when a verified patch is available.

## Roll back an incompatible update

Revert the dependency change and its required application compatibility edits together. Run `npm ci`, regenerate the Prisma client, and repeat the checks in an isolated installation. No database schema change is required by these updates. A rollback can restore known dependency vulnerabilities, so it is a temporary compatibility recovery, not a security fix.

[Public-source policy](OPEN_SOURCE_READINESS.md) · [Security policy](../SECURITY.md) · [Documentation index](README.md)
