# Public source and release policy

Flowrish's original code and documentation use the [MIT license](../LICENSE). Dependency licenses remain separate; see [third-party notices](../THIRD_PARTY_NOTICES.md). The npm `private` flag prevents accidental package publication and does not control GitHub visibility.

## Keep the public tree useful

Publish application source, tests, migrations, example configuration, contributor guides, architecture, feature guides, and reusable recovery procedures. Keep internal specifications, implementation plans, session notes, personal editor automation, private release evidence, credentials, customer exports, and browser authentication outside the repository.

Ignore rules prevent new local working files from being added accidentally. They do not remove tracked files or historical copies. Review the complete staged diff before publishing. Removing a file from main does not remove it from Git history, clones, forks, Actions logs, or artifacts. Any history rewrite requires a separate decision and coordination.

The repository retains its existing history. No public-tree cleanup guarantees that historical content has disappeared or that every possible credential format has been detected. If a real credential was exposed, rotate it and assess historical copies; a deletion commit alone is insufficient.

## Validate a release

Run the checks in the [contributor guide](../CONTRIBUTING.md), including `npm run test:startup` and `npm run test:public-repository`. The public-source check rejects internal planning/editor paths, environment-file variants, personal filesystem paths in Markdown, broken relative links, conflicting README license wording, and unknown documented npm commands.

Review file ownership and third-party notices when adding assets or copied code. Before distributing compiled bundles or containers, review the licenses of the dependencies included in that artifact.

## Separate source from the hosted service

The source license grants no access to Flowrish's hosted application, customer data, credentials, API credits, or trademarks. Use your own services. Website and phone reception require explicit activation; tests must not enable them.

Production helper repository names, project identifiers, public hostnames, and CA fingerprints identify the intended release target. They are public identifiers, not credentials. Keep their checks intact. Fork maintainers must configure separate services and a reviewed release pipeline.

The production workflow is restricted to main pushes in the maintainer repository. Forks run validation and skip hosted production jobs. Follow the [deployment guide](ops/production-deployment.md) and [security policy](../SECURITY.md). Do not bypass release gates to work around an unavailable runner budget.

AI-generated answers, mocked rehearsals, and deployment checks provide different evidence. Document which was tested, the request budget, and any unverified paths. A scripted rehearsal does not establish live AI, customer-pilot, phone, or production-backup readiness.
