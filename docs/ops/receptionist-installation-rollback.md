# Receptionist installation checker rollback

Baseline `8cc877b5bc309a6637864d2c07c301a2d40da2a5`. This release adds a source-check component, an administrator POST endpoint, and bounded native HTTPS/scanner code. It changes no schema, dependency, provider credential, business setting, widget activation, or scheduled function.

If checks report misleading matches, reject valid setup unexpectedly, or affect guided setup, revert the feature merge and redeploy:

```sh
git log --oneline --first-parent --grep='Merge receptionist installation checker'
git revert -m 1 <merge-commit-from-the-log>
```

A normal code revert restores the previous application. The only server write is an organization-scoped Redis cooldown with a 30-second expiry. Let those keys expire; do not flush Redis, edit applied migrations, drop callback tables, change provider settings, or restore a database snapshot. No Inngest registration change is required. Public-page GETs already sent cannot be undone.

Before release, prove the staged code reversal restores the exact baseline tree using a temporary Git index. Verification mocks DNS/native HTTPS, Redis, and successful browser check POSTs; it forbids AI/Twilio/widget traffic and unrelated mutations. Production smoke checks send only invalid or unauthenticated requests that stop before outbound work, plus read-only metadata/count queries. Never actually crawl a business website, enable a widget, create production test business data, or retrieve/decrypt/use the saved AI key during verification.
