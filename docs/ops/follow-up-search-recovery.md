# Recover follow-up search and filters

This feature adds optional filters to the existing follow-up listing and a private, per-session search form. There are no schema, dependency, provider or scheduled-job changes. Revert the search feature commit and release normally if filtering gives incorrect results. Existing leads, reviews, snoozes and audit records remain intact; no data repair is required.

The synthetic PostgreSQL drill used 105 recent records plus older fixtures to prove filtering before the100-item cap, literal case-insensitive text matching, source/due filters, retained-draft exceptions and current access checks. Filters add no workflow writes beyond the existing listing behavior.

After release or revert, verify the exact SHA, all CI/release gates, anonymous filtered-list API denial and the widget remaining off. Do not use real provider requests, emails or production test records. Do not restore a whole database snapshot or modify applied migrations for this code-only change.

Search covers lead names, lead email and follow-up titles. It returns up to100 matching recent items plus authorized retained drafts and focused replies. Apply/Clear uses the existing unsent-draft confirmation; typing alone makes no request. Due-only means elapsed personal snoozes awaiting review in Pending; leaving Pending clears that flag. Search text/source remain across tabs, and all private filter state clears on workspace/user changes or revoked access. Filters are not stored across devices. Fuzzy matching, body search and full-text ranking are outside this release.
