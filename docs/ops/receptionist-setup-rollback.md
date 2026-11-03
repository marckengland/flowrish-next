# Guided receptionist setup rollback

The baseline before this code-only release was `6d186c863a1704463eb27d6273189f7fa2e19970`. No schema, migration, dependency, credential, or deployment configuration changes are included. Deploying the guide does not activate reception or modify business settings. A read-only production query before release found zero saved website configurations and zero enabled widgets.

If the guide fails to load or blocks onboarding, remove it through the normal deployment pipeline:

```sh
git log --oneline --first-parent --grep='Merge guided receptionist setup'
git revert -m 1 <merge-commit-from-the-log>
```

A clean code revert restores the previous application in one deployment. The standalone Settings and Library workflows remain available. Before release, a temporary Git index must prove that reversing the feature patch restores the exact baseline tree.

Separately approved business edits, document publications/approvals, website settings, and activation remain saved after a code rollback. Correct those deliberately in Settings or the Library; do not overwrite later edits or restore the database. To stop live website traffic, an administrator can explicitly disable **Website receptionist** in Settings. Reverting the guide alone does not stop an already-enabled widget.

Verification uses a disposable PostgreSQL database, mocked browser writes, and read-only production metadata. It must never read/decrypt/use the saved DeepSeek key, call a provider or Twilio, create production CRM data, or enable a production widget.
