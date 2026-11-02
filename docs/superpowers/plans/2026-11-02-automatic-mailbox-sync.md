# Automatic mailbox sync

User said go to automatic reply monitoring, last synced status and failure alerts. Complete, test, merge and deploy under existing session authorization. No dependencies.

## Backend task
Use existing Inngest scheduler every5min to enqueue due connected Gmail/Microsoft mailboxes. Peraccount concurrency prevents overlap. State with safe last attempted/last synced, queue/running/failure/retry indication. Store health metadata on EmailAccount (additive migration, no secrets exposed). Use a centralized requestMailboxSync(orgId,userId,provider?) for manual route and scheduler internal eligible IDs. Claim queue lease atomically and release/markfailed if enqueue fails. Running stale lease can retry after bounded interval; duplicate scheduled dispatch no fanout. onFailure callback records sanitized actionable generic error, not raw exception/provider response. Success clears failure and advances lastSyncAt only after all provider messages and reply reconciliation complete. Manual route support explicit provider (gmail/microsoft), existing no-body call compatible. Only currentmember/leads permissions for manual and status; scheduled restrict accountmember validity. Never send an email from sync.

Paginate Gmail and Graph using last successful start-time checkpoint minus overlap (initial last24h). Finish all pages before moving checkpoint; bound work with visible failure if cap exceeded. Do not skip failed detailfetch and still markhealthy (except deleted404 intentionally documented). Prevent Graph nextLink SSRF/provider-host escape. Sync peraccount serialized. Retries keep watermark, partial stored rows safely replay from savedmetadata. Retain legacy identity and ambiguitysafe matching from priorfeature.

API GET /api/email/sync -> {data: MailboxSyncHealth[]} callerorg+user only leads:read, no creds. Health item {id,provider,email,lastSyncAt:string|null,lastAttemptAt:string|null,status:'idle'|'queued'|'running'|'healthy'|'failed',error:string|null,automatic:boolean,requestedAt:string|null}. automatic true only configured scheduler credentials (indicates enabled, not proof of external registration). POST samepath body optional {provider:'gmail'|'microsoft'} require leads:write; returns {data:{accountId,status:'queued'|'running'}} or existing noaccount validationerror. GET may include stalehealth as error safe label. UI will consume exactcontract; communicate adjustments early.

## UI task
Replace EmailSyncStatus with live per-mailbox health, last successful sync, automatic every5min copy, queued/running separate success, failures rolealert, per-mailbox Sync now request explicitprovider, manual refresh and polling only while visible (15-30s). Empty/notconfigured/error/loading accessible. canWrite optional defaulttrue backwards compatibility; followup page provides actualpermission and mountsstatus prominently. Existing Settings calling may have different permissions; ensure no mutationcontrols when readonly. No automatic clicking sync from client. Existing composer unaffected. Componenttests with fakeHTTP assertnoautopost, failure/queued/success distinguish, provider selection, pollingcleanup/read-only. No dependencies.

## Verify and rollout task (root)
TDD meaningful unit tests and realPG queue/concurrency/checkpoint/rollback tests; fulltests lint --fix both typechecks build. Readonly deployedE2E mock provider activity for health cases; no external sends. Independentreview allcode. Additive schema retained on code rollback, checkpoints/history preserved. Test reversepatch on disposablearchive beforemerge; preserve unrelateduntrackedfiles. Applymigration only afterrealPG; capture beforeafter mailboxcount/CRMcounts withoutaddresses. Merge/push afterfullchecks, verifyCI and deployed functionregistration safely. Existingmailboxmaynowread automatically as userauthorized; do not intentionally send real email or expose secrets.

Ruling: five-minute polling reuses existing durable jobs; provider push webhooks deferred. This is simpler operationally but replies may arrive up to one polling interval before detection. Provider/API failures must surface in UI and retry. No full email retrieval or AI draft generation in this task.

## Verification ledger
- Baseline: 1,001 tests passed.
- Additive migration applied; before/after counts unchanged: 2 orgs,10 leads,7 tasks,9 activities,1 mailbox,0 messages.
- Seven new real PostgreSQL lifecycle/concurrency/heartbeat tests passed. Existing9 follow-up and4 receptionist database tests passed.
- Compiled browser suite:26 passed,4 existing guarded navigation cases skipped; new health checks all passed. Synthetic provider selection POST is intercepted and queues no real work.
- Review corrected long-backfill lease renewal; original checkpoint stays frozen while executed pages heartbeat. Independent review found no other high/medium issues.
- Local Inngest values are placeholders; production scheduler registration must be verified separately after deploy. Do not claim monitoring active from key presence alone.
