# Flowrish documentation

Start with the [setup guide](SETUP_GUIDE.md), [contributor guide](../CONTRIBUTING.md), and [testing guide](TESTING.md). Use your own services and development data.

## Architecture and integrations

- [Architecture and workspace isolation](ARCHITECTURE.md)
- [User manual](USER_MANUAL.md)
- [Email, calling, and migration integrations](INTEGRATIONS.md)
- [Organization AI providers and usage limits](AI_PROVIDER_SETTINGS.md)
- [Automatic mailbox synchronization](AUTOMATIC_MAILBOX_SYNC.md)

## Sales workflows

- [Follow-up approval inbox](FOLLOW_UP_INBOX.md)
- [Conversation-based email drafts](CONVERSATION_DRAFTS.md)
- [Saved lead views](SAVED_LEAD_VIEWS.md)
- [Reviewed bulk lead updates](bulk-lead-updates.md)
- [Reviewed duplicate merges](safe-lead-merges.md)
- [Merge-aware reply detection](merge-aware-replies.md)
- [Do-not-contact controls](contact-preferences.md)
- [Business switching](workspace-switcher.md)
- [Follow-up access rules](follow-up-access.md)
- [Email notifications](email-notifications.md)

## Receptionist and business knowledge

- [Business knowledge library](BUSINESS_KNOWLEDGE.md)
- [Browser preview and microphone testing](RECEPTIONIST_PREVIEW.md)
- [Website receptionist, callbacks, and calendar rules](WEBSITE_RECEPTIONIST.md)
- [Optional phone receptionist](AI_RECEPTIONIST.md)
- [Staff waitlist](STAFF_WAITLIST.md)
- [Private pilot onboarding](approved-pilot-onboarding.md)

Website and phone reception start disabled and require separate activation. Scripted demonstrations and mocked tests do not establish live AI or phone quality.

## Releases and recovery

- [Public source and release policy](OPEN_SOURCE_READINESS.md)
- [Production deployment gates](ops/production-deployment.md)
- [Deployment recovery](ops/production-deployment-rollback.md)
- [Synthetic backup and restore drill](ops/backup-recovery.md)
- [Security reporting](../SECURITY.md)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)

Feature-specific runbooks remain in `docs/ops` and `docs/recovery`. Keep the schema compatibility and duplicate-protection requirements when adapting a recovery procedure. Private plans, personal editor state, and operational evidence belong outside this repository. Public identifiers in deployment guards are not credentials; forks need their own services and release policy.
