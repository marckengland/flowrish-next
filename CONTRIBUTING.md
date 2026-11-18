# Contributing to Flowrish

Open an issue describing the problem or proposed change before starting substantial work. Keep pull requests focused and include a concrete example of the resulting behavior.

## Local setup

Use Node.js 22, `npm ci`, and your own credentials copied into `.env` from `.env.example`. Follow the [setup guide](docs/SETUP_GUIDE.md). Never commit credentials, exported customer records, browser authentication state, or production logs. Do not use the hosted Flowrish database for local tests.

Prisma loads `.env` with override enabled. Shell datasource variables do not override that file. Never use `prisma db push` from this checkout for disposable test setup. Follow `AGENTS.md` for the isolated copied-schema procedure.

## Verification

Run `npm run test:startup` and `npm run test:public-repository` to verify the launchers and public documentation without services or installed dependencies. Startup tests use synthetic commands in temporary directories. CI runs them on Linux and Windows.

Run `npm test`, `npm run lint`, `npm run build`, then `npx tsc --noEmit` and `npm run typecheck:fast`. Run strict type checks after the build because Next replaces generated types. For browser behavior, run `npm run test:receptionist:mocked`; install its Chromium runtime first with `npm run test:e2e:install` when needed.

The normal test suite and mocked browser rehearsal must not use real AI providers, send email, call phone services, or change production data. Live checks require separate explicit authorization, a request limit, and synthetic inputs. Do not weaken or skip tests to make a change pass. Explain changed behavior and preserve existing coverage.

For database changes, add a reviewed migration and test it in a disposable database. Preserve access controls, workspace isolation, explicit approval, and recovery for uncertain results. Include rollback instructions for persistent changes.

## Pull requests

Keep internal specifications, implementation plans, session notes, personal editor hooks, and private release evidence outside this repository. Do not add them under another directory to bypass the ignore rules. Public documentation should explain current behavior, setup, architecture, testing, and reusable recovery procedures. Moving a file out of the current source tree does not remove its Git history.

Describe the problem, the final behavior, and the checks you ran. Mark interrupted or skipped checks as unverified and explain why. Do not paste credentials, private customer examples, or raw production logs into an issue or pull request.

Submit only work you have the right to contribute under the [MIT license](LICENSE). Keep notices for third-party code and document its source. A contribution does not grant permission to use another organization’s credentials, data, or trademarks.
