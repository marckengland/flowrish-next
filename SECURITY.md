# Security policy

Security fixes are developed against the current main branch. There is no guaranteed response or support timeline.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/marckengland/flowrish-next/security/advisories/new) when it is enabled. If the private form is unavailable, ask a maintainer for a private reporting channel without posting exploit details, credentials, or customer information publicly.

Include affected versions, a minimal reproduction using synthetic records, the expected access boundary, and the observed result. Redact tokens, cookies, API keys, connection strings, and personal data.

Do not test against the hosted Flowrish service, other users’ workspaces, or third-party accounts without the owner’s explicit permission. Use your own isolated installation. The open-source license grants no authorization to access the hosted service or customer data.

## Credentials and deployment

Keep environment files, authentication state, database exports, test traces, and private logs out of Git and public artifacts. Rotate a credential if it was exposed; deleting it from the latest commit is insufficient because Git history and old artifacts may retain it.

Production jobs are restricted to a push to main in the maintainer’s repository and require the configured Production environment. Forks must provision their own services and release pipeline. Do not bypass the production gate to work around an unavailable CI budget.

AI provider keys remain server-side and encrypted at rest. Keep organization usage limits and explicit action confirmation enabled. Website and phone reception are separate opt-in settings; running tests must not enable them.
