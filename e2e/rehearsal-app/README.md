# Mocked receptionist browser rehearsal

Run `npm run test:receptionist:mocked` from the repository root. Install the existing browser dependency first if needed: `npx playwright install chromium`.

The command builds this separate fixture application and runs the existing 30 browser scenarios. It imports the real client components, uses synthetic read data, and runs without authentication or production credentials. It does not import the production middleware, server modules, database, or auth client.

The runner removes inherited credentials and URLs. Server sockets can reach only its selected loopback ports; private environment files cannot be read (the checked-in `.env.example` template is permitted). Chromium uses a proxy that permits fixture reads and blocks every other destination or unmocked mutation. Negative probes verify these guards before the workflows run. Any guard violation fails the command even if the UI swallows the error. Results are under the ignored `test-results/rehearsal/` directory.

There is no auth setup, saved browser session, retry, or production base URL. All 30 scenarios must pass without skips. Update the explicit selection and count together when adding coverage. CI runs this command alongside the unit suite; migrations wait for both checks. CI generates the project's Prisma types with dummy URLs and makes no database connection.

This fixture checks client workflows. Production authentication and database transactions remain separate coverage. The normal Flowrish app gains no test login mode or fixture routes. Production receptionist/widget settings are never changed.
