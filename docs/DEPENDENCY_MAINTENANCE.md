# Maintain dependency security

Use Node.js 22 and the committed npm lockfile. Review security updates on a branch, install with `npm ci`, and run the [development checks](TESTING.md#run-the-full-development-checks). Do not use `npm audit fix --force` without reviewing the proposed major changes or downgrades.

## Check runtime and development dependencies

```sh
npm audit --omit=dev --audit-level=high
npm audit --json
npm ls --all
```

The first command rejects critical/high findings in the production dependency tree. The full audit also includes build, lint, test, and code-generation tools. A finding inherited by several parent packages can represent one underlying advisory. Neither a passing test suite nor an empty audit proves that the application has no security defects.

CI runs the production critical/high gate and a full-tree critical gate. Review every high finding in the full audit. An exception for one advisory does not approve unrelated findings.

`shadcn` is a development dependency. Its CLI generates source components, and the build imports `shadcn/tailwind.css`. Install development dependencies before building. The running app uses the compiled CSS and checked-in components without importing the CLI.

## Review the compatibility overrides

| Override | Reason | Check before removing it |
|----------|--------|--------------------------|
| `zod` → root version | Keep the patched package throughout the graph | Confirm that application schemas use the patched API and SDK compatibility imports still work |
| `@prisma/config` → `deepmerge-ts` 8.0.2 | Fix recursive-object handling while retaining Prisma 6 | Run offline config/schema generation and disposable database checks; version 8 changes Map merging |
| `@prisma/config` → `effect` 3.22.1 | Fix template-literal regex backtracking, [GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw), while retaining Prisma 6.19.3 | Confirm Prisma selects a patched Effect version without the override, then run config/schema generation, the build, and disposable database checks |
| `next` → `postcss` 8.5.33 | Replace Next 15's pinned parser with the patched version | Run the production build and mocked browser build |
| `vitest` → `tinypool` 2.2.0 | Fix worker-option prototype-pollution handling | Run the full suite under Node 22, including subprocess tests |
| `@opentelemetry/propagator-jaeger` → 2.9.0 | Use its security fix with the retained telemetry API generation | Check telemetry peer ranges before choosing a later version |
| `@opentelemetry/otlp-transformer` → `protobufjs` 8.8.1 | Replace a pinned vulnerable serializer | Run worker and transport compatibility checks |

The Inngest SDK uses Zod's legacy compatibility entry point for its own schemas. Application request validation uses the patched main API. A package-wide version override does not mean every bundled legacy API acquired the same fixes. In the retained SDK, the constrained legacy array holds developer-owned concurrency configuration; cloud execution parsing follows signature validation. Recheck those boundaries when changing the SDK or exposing development mode.

## Withdrawn development-tool advisory

The November 18, 2026 audit reported [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) through development tools that use Picomatch. The maintainer accepted a development-tool exception at that time.

GitHub has since marked the advisory withdrawn on November 18, with its record updated November 19, because the reported behavior is not a security issue. The November 22 audit no longer reports this advisory. This changed advisory status does not mean that a package upgrade fixed it.

The earlier exception is historical and does not approve future findings. Keep audit gates enabled and review changes to build/test configuration before running them with privileged credentials. Do not rename vulnerable packages or suppress advisories globally.

## Roll back an incompatible update

Revert the dependency change and its required application compatibility edits together. Run `npm ci`, regenerate the Prisma client, and repeat the checks in an isolated installation. No database schema change is required by these updates. A rollback can restore known dependency vulnerabilities, so it is a temporary compatibility recovery, not a security fix.

[Public-source policy](OPEN_SOURCE_READINESS.md) · [Security policy](../SECURITY.md) · [Documentation index](README.md)
