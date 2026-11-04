# Repository instructions

- `prisma.config.ts` loads the project `.env` with `override: true`, overriding shell datasource variables. Never run `prisma db push` from this checkout for test setup. For local database verification, copy the schema to a temporary directory, use an explicit configuration with loopback-only dummy URLs, generate SQL offline, and apply it through `docker exec psql` inside the disposable test container. Production DDL uses reviewed migrations only.
- Project checks: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:fast`, `npm run build`, and `npm run test:receptionist:mocked`. Run strict type checks after the Next build, not alongside it, because the build replaces generated Next types.
