# Operate and recover Flowrish

Use these guides when deploying an installation, diagnosing a failed workflow, or rolling back a change. Start with the observed problem. A rollback changes application behavior; it does not recall an email, reverse a completed CRM action, or restore external service credentials.

## Installation and releases

| Task | Guide |
|------|-------|
| Run a new installation | [Setup](../SETUP_GUIDE.md) |
| Check release gates and commit identity | [Production deployment](production-deployment.md) |
| Recover a failed deployment | [Deployment rollback](production-deployment-rollback.md) |
| Check backup coverage and run an isolated restore drill | [Backup and recovery](backup-recovery.md) |
| Understand what belongs in the public repository | [Open-source readiness](../OPEN_SOURCE_READINESS.md) |
| Choose a safe test environment | [Testing](../TESTING.md) |

## AI and business knowledge

| Problem or change | Guide |
|-------------------|-------|
| Organization provider setup, limits, or failure | [AI provider rollout](ORG_AI_PROVIDER_ROLLOUT.md) |
| Library publication or caller approval | [Knowledge rollout and rollback](BUSINESS_KNOWLEDGE_ROLLOUT.md) |
| Browser preview deployment | [Preview rollout](RECEPTIONIST_PREVIEW_ROLLOUT.md) |
| Explicitly authorized live AI verification | [Live AI test procedure](RECEPTIONIST_LIVE_AI_TEST.md) |

## Receptionist and callbacks

| Problem or change | Guide |
|-------------------|-------|
| Phone answering | [Phone setup](../AI_RECEPTIONIST.md) and [rollback](../AI_RECEPTIONIST_ROLLBACK.md) |
| Website sessions or public widget | [Website rollback](website-receptionist-rollback.md) |
| Business onboarding | [Setup rollback](receptionist-setup-rollback.md) |
| Widget installation | [Installation rollback](receptionist-installation-rollback.md) |
| Saved mock rehearsal | [Rehearsal rollback](receptionist-rehearsal-rollback.md) |
| FAQ review after rehearsal | [Rehearsal FAQ rollback](rehearsal-faq-rollback.md) |
| Missing business information | [Knowledge-gap rollback](knowledge-gaps-rollback.md) |
| Callback handoff into CRM | [Handoff rollback](callback-handoff-rollback.md) |
| Callback outcome recording | [Outcome rollback](callback-outcomes-rollback.md) |
| Callback alerts | [Notification rollback](callback-notifications-rollback.md) |
| Callback response targets | [Response-target rollback](callback-response-targets-rollback.md) |
| Requested callback times | [Preferred-time rollback](preferred-callback-time-rollback.md) |
| Closures or date-specific hours | [Calendar exception rollback](business-calendar-exceptions-rollback.md) |
| Receptionist metrics | [Performance rollback](receptionist-performance-rollback.md) |
| Visitor feedback | [Feedback rollback](visitor-feedback-rollback.md) |
| Staff waitlist access | [Waitlist rollback](staff-waitlist-rollback.md) |

## Follow-up inbox

| Problem or change | Guide |
|-------------------|-------|
| Access or workspace isolation | [Access recovery](../recovery/follow-up-access.md) |
| Search and filters | [Search recovery](follow-up-search-recovery.md) |
| Private saved views | [Saved-view recovery](saved-follow-up-views-recovery.md) |
| Refresh, offline state, or interrupted reads | [Inbox freshness](inbox-freshness.md) |
| Large-inbox query or render costs | [Performance checks](inbox-performance.md) |
| Snoozes or reminders | [Snooze recovery](follow-up-snooze-recovery.md) |
| Bulk controls | [Bulk actions menu](follow-up-bulk-actions-menu.md) |
| Task approval | [Bulk approval recovery](bulk-follow-up-approval-recovery.md) |
| Approved task status | [Task-progress recovery](approved-task-progress-recovery.md) |
| Task completion | [Completion recovery](approved-task-completion-recovery.md) and [bulk completion](bulk-task-completion-recovery.md) |
| Task deadlines | [Reschedule recovery](approved-task-reschedule-recovery.md), [bulk rescheduling](bulk-task-rescheduling-recovery.md), and [deadline sorting](approved-deadline-sort-recovery.md) |
| Task activity | [Task-history recovery](approved-task-history-recovery.md) |
| Full activity history, filters, or export | [History recovery](follow-up-history-recovery.md) |
| Saved bulk-review history | [Bulk-history recovery](saved-bulk-action-history-recovery.md) |
| Saved draft text or revision conflicts | [Compose draft behavior](saved-compose-drafts.md) and [rollback](saved-compose-drafts-rollback.md) |
| A send has an uncertain outcome | [Send-result recovery](send-result-recovery.md) and [rollback](send-result-recovery-rollback.md) |
| Send status, freshness, or Needs checking | [Send-status behavior](follow-up-send-status.md) and [rollback](follow-up-send-status-rollback.md) |

## Leads and incoming replies

| Problem or change | Guide |
|-------------------|-------|
| Saved lead views | [Saved-view rollback](saved-lead-views-rollback.md) |
| Bulk lead edits | [Bulk-update recovery](../recovery/bulk-lead-updates.md) |
| Do not contact | [Contact-preference recovery](../recovery/contact-preferences.md) |
| Duplicate merges | [Merge recovery](../recovery/safe-lead-merges.md) |
| Archived-address reply routing | [Reply-match recovery](../recovery/merge-aware-replies.md) |
| Reply and follow-up alerts | [Notification recovery](../recovery/email-notifications.md) |

Keep execution logs, database exports, screenshots, and environment-specific recovery evidence outside the repository. Before applying a recovery patch, read its linked procedure and verify the current source and migration state.

[Documentation index](../README.md) · [Architecture](../ARCHITECTURE.md) · [Data flows](../DATA_FLOWS.md)
