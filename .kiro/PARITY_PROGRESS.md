# Flowrish ➜ flowrish-next parity progress

This doc tracks progress restoring features from the original Flowrish
React app (`packages/frontend`) into this Next.js port.

## Verification baseline

- `npx tsc --noEmit` — green project-wide
- `npx vitest run` — **875 / 875 tests passing across 75 files**
- Component parity: every original component file has a matching port
  (audit confirmed 60 direct ports + 13 intentional consolidations)

## Recent feature additions (June 2026)

### Rich text editor — font size dropdown
- `RichTextEditor` now exposes a font-size popover with eight pixel
  presets (12–32 px) plus a "Default" reset. Applied as a custom TipTap
  `FontSize` mark layered on `TextStyle`, so output is plain `style="font-size:…"`
  spans that survive sanitization in the email pipeline.
- File: `src/components/email/rich-text-editor.tsx`

### Email threading by default
- `EmailCompose` accepts an optional `latestThread` prop. When the lead
  has any prior thread, the form defaults to "Reply on existing thread"
  with the subject locked to `Re: <thread subject>`. A toggle row lets
  the user flip to "Start new thread" before sending.
- The lead detail page hydrates `latestThread` server-side from the most
  recent `EmailMessage` row touching the lead's email address (in
  either direction), then forwards it through `LeadTabs` →
  `ActivitiesTab`/`EmailsTab` → `EmailCompose`.
- Files: `src/components/email/email-compose.tsx`,
  `src/components/leads/lead-tabs.tsx`,
  `src/app/(dashboard)/leads/[id]/page.tsx`

### Cadence schedule (days / time / timezone)
- New `CadenceSchedule` Prisma model (one-to-one with `Cadence`) stores
  `name`, `daysOfWeek` (0-6, Sun-Sat), `startTimeMinutes`,
  `endTimeMinutes`, and an IANA `timezone` string. Migration:
  `prisma/migrations/20260605000000_add_cadence_schedule`.
- Service: `setCadenceSchedule`, `getCadenceSchedule`,
  `deleteCadenceSchedule`, plus a pure `computeNextAllowedRunTime`
  helper used by the runner and (potentially) the UI preview.
- API route: `GET/PUT/DELETE /api/cadences/[id]/schedule`.
- UI: new "Schedule" tab on the cadence detail page rendering
  `CadenceScheduleEditor` — name field, From/To time inputs (15 min
  steps), timezone dropdown (IANA list with browser TZ pinned at top),
  Monday-first day-of-week toggles, and a destructive "Remove schedule"
  control.
- Inngest gating: `cadenceStepFunction` looks up the cadence schedule
  before executing each step. When the current moment falls outside the
  configured window, it computes the next allowed slot and uses
  `step.sleepUntil` to defer execution. Outside-of-window steps no
  longer fire at odd hours.
- Files: `prisma/schema.prisma`, `src/server/db/middleware.ts` (added
  `CadenceSchedule` to `TENANT_SCOPED_MODELS`),
  `src/server/services/cadences.ts`,
  `src/app/api/cadences/[id]/schedule/route.ts`,
  `src/components/cadences/cadence-schedule-editor.tsx`,
  `src/app/(dashboard)/cadences/[id]/page.tsx`,
  `src/server/inngest/cadence-step.ts`

### Email body attachments via drag-drop / paste
- `RichTextEditor` exposes an `onFilesDropped` prop. When supplied, the
  editor wraps its panel with drag/paste handlers and surfaces an
  overlay ("Drop files to attach") while a drag is hovering. Files are
  forwarded as a `File[]` to the parent — the editor itself never tries
  to embed binary content.
- `EmailCompose` wires `onFilesDropped={appendFiles}` so dropped/pasted
  files land in the same attachment list the manual "Attach file"
  button populates. They get sent as part of the multipart Gmail
  payload by the existing `/api/email/send` route.
- Files: `src/components/email/rich-text-editor.tsx`,
  `src/components/email/email-compose.tsx`

### Email formatting fidelity (sender ↔ receiver)
- Outgoing emails are now sent as `multipart/alternative` (HTML +
  plain-text fallback). Recipients on rich clients see the editor's
  formatting; recipients on text-only clients (or accessibility
  readers stripping HTML) get a clean plain-text version derived from
  the same content via the new `htmlToPlainText` helper. Link targets
  surface as `text (url)` so they remain clickable.
- Both subparts are emitted with `Content-Transfer-Encoding:
  quoted-printable` so non-ASCII characters (em dashes, smart quotes,
  accented names from personalization tags) survive transit
  unchanged. A new RFC 2045 quoted-printable encoder handles soft
  line wrapping (≤ 76 chars) without splitting `=XX` triplets and
  protects trailing whitespace with `=20`.
- The Subject header is wrapped in RFC 2047 encoded-word form
  (`=?UTF-8?B?...?=`) when it contains non-ASCII characters.
- `wrapHtmlEmail` now applies the base typography directly to the
  `<body style="…">` tag (in addition to the `<head><style>` block)
  so Outlook (which strips `<style>`) renders identical type, line
  height, and color. Anchor tags carrying the editor's Tailwind
  `text-blue-600 underline` class are post-processed into inline
  `style="color:#2563eb;text-decoration:underline;"` so links remain
  blue and underlined without a stylesheet.
- The attachment-bearing path now nests the body alternatives under
  `multipart/mixed`, so attachments + dual-format body coexist on the
  wire (`multipart/mixed > multipart/alternative > {plain, html}`).
- Attachment filenames are still sanitized (CR/LF/quote stripped) to
  prevent header injection.
- 23 new unit tests pin the wire-format invariants — bold/italic/
  underline/strike preservation, color/font-size inline styles, list
  rendering, link inlining, quoted-printable round-trip, RFC 2047
  Subject encoding, both `text/plain` and `text/html` parts present,
  attachment Content-Disposition, filename sanitization.
- Files: `src/server/services/email.ts`,
  `src/server/services/__tests__/email-formatting.test.ts`

### Cadence step template attachments + real Gmail send
- Cadence steps can now carry **template-level file attachments** that
  travel with every email the step sends. Files are uploaded once when
  the step is authored and re-attached for every enrolled lead.
- New `CadenceStepAttachment` Prisma model (per-org tenant-scoped, FK
  to `CadenceStep` with `onDelete: Cascade`). Migration:
  `prisma/migrations/20260608060000_add_cadence_step_attachment`.
- New service functions: `listCadenceStepAttachments`,
  `uploadCadenceStepAttachment`, `deleteCadenceStepAttachment`,
  `fetchCadenceStepAttachmentBytes`. Files live in the same Supabase
  Storage `attachments` bucket as lead-level uploads, but under the
  `cadences/{orgId}/{stepId}/…` prefix to keep the namespaces separate.
- API routes: `GET/POST /api/cadences/[id]/steps/[stepId]/attachments`,
  `DELETE /api/cadences/[id]/steps/[stepId]/attachments/[attachmentId]`.
- UI: the cadence **step editor** (Edit step dialog) now renders an
  `Attachments` section below the body for EMAIL steps (edit mode
  only — new steps need to be saved first to associate files). Three
  affordances:
   1. Paperclip in the rich-text-editor toolbar
   2. "Attach file" button next to the Attachments header
   3. Drag &amp; drop or paste files into the body
- **Cadence runner now actually sends via Gmail.** The Inngest step
  function previously created a placeholder `Activity` row and stored
  a synthesised `thread-…-…` string. It now calls the real
  `sendEmail` service with the step's subject, body, the enrollment's
  Gmail thread id (so follow-up steps reply on the same conversation),
  and the step's template attachments. The real Gmail thread id is
  persisted to `CadenceEnrollment.emailThreadId` after the first send
  so subsequent steps thread correctly. Activity creation and
  `lead.lastActivityAt` updates are delegated to `sendEmail`.
- Steps with no email address on the lead are skipped with a NOTE
  activity so the cadence advances without erroring.

## Component-level parity (60 direct ports)

| Original folder/component | Port location |
|---|---|
| activities/ActivityForm | activities/activity-form |
| activities/ActivityTimeline | activities/activity-timeline |
| activities/FileUpload | activities/file-upload |
| ai/AccountResearchPanel | ai/account-research |
| ai/AiEmailGenerator | ai/email-generator |
| ai/AiPromptConfigPanel | ai/ai-prompt-config |
| ai/ChatbotSidebar | ai/chatbot-sidebar |
| ai/ChatbotWidget | ai/chatbot-toggle |
| audit/AssignmentRuleConfig | admin/assignment-rules |
| audit/AuditLogTable | admin/audit-log-table |
| audit/DeletionRequests | admin/deletion-requests |
| audit/UserManagement | admin/user-management |
| cadences/AnalyticsPanel | cadences/cadence-analytics |
| cadences/CadenceForm | cadences/cadence-name-dialog |
| cadences/CadenceList | cadences/cadence-list |
| cadences/EnrollLeadDialog | cadences/enroll-dialog |
| cadences/EnrollmentTable | cadences/enrollment-list |
| cadences/StepEditor | cadences/step-editor |
| companies/CompanyDetail | companies/company-detail |
| companies/CompanyForm | companies/company-form |
| companies/CompanyList | companies/company-table |
| companies/DeleteCompanyDialog | companies/delete-company-dialog |
| contacts/ContactForm | contacts/contact-form |
| contacts/ContactList | contacts/contact-table |
| csv/CsvExportButton | csv/export-button |
| csv/CsvImportWizard | csv/import-wizard |
| dashboard/BarChart | dashboard/bar-chart |
| dashboard/DateRangeFilter | dashboard/date-range-filter |
| dashboard/MetricCard | dashboard/metric-card |
| email/EmailCompose | email/email-compose |
| email/EmailConnect | email/gmail-connect |
| email/EmailSyncStatus | email/email-sync-status |
| email/RichTextEditor | email/rich-text-editor |
| layout/Header | layout/header |
| layout/Shell | layout/shell |
| layout/Sidebar | layout/sidebar |
| leads/LeadCreateForm | leads/lead-form |
| leads/LeadDetailPanel | leads/lead-detail |
| leads/LeadStageTransition | leads/lead-stage-transition |
| leads/LeadTabs | leads/lead-tabs |
| pipeline/KanbanBoard | pipeline/kanban-board |
| pipeline/LeadCard | pipeline/kanban-card |
| rhythm/CoachingComments | rhythm/coaching-comments |
| rhythm/ConversationIntelligence | rhythm/conversation-intelligence |
| rhythm/DealGapsPanel | rhythm/deal-gaps-panel |
| rhythm/DealScoresPanel | rhythm/deal-scores-panel |
| rhythm/ForecastPanel | forecast/forecast-panel |
| rhythm/TeamRhythm | rhythm/team-rhythm |
| scoring/RankedLeadList | scoring/ranked-lead-list |
| scoring/ScoreBadge | scoring/score-badge |
| scoring/ScoreDecayConfig | scoring/score-decay-config |
| scoring/ScoringRuleList | scoring/scoring-rules |
| search/FilterPanel | search/filter-panel |
| search/SearchBar | search/search-bar |
| search/SearchResults | search/search-results |
| tasks/TaskForm | tasks/task-form |
| tasks/TaskList | tasks/task-list |
| tasks/TaskReassign | tasks/task-reassign |
| ui/button | ui/button |
| ui/HelpTooltip | ui/help-tooltip |

## Intentional consolidations (13)

| Original | Where it lives now |
|---|---|
| auth/RequireAuth | Replaced by Next middleware |
| cadences/CadenceStatusBadge | Exported from `cadences/cadence-list` as `StatusBadge` |
| cadences/StepCard | Inlined into `cadence-builder` |
| cadences/StepMetricsBar | Inlined into `cadence-analytics` |
| cadences/StepTimeline | Inlined into `cadence-builder` |
| csv/CsvView | Is the page itself |
| dashboard/DashboardView | Is the page itself |
| pipeline/PipelineSelector | Skipped — only one pipeline per org today |
| pipeline/StageColumn | Inlined into `kanban-board` |
| rhythm/ForecastComparison | Superseded by `app/(dashboard)/forecast` page |
| rhythm/RhythmDashboard | Inlined into `app/(dashboard)/rhythm` page |
| scoring/ScoringRuleForm | Inlined into `scoring-rules` |
| search/SearchView | Is the page itself |

## New / extended in the port (not in original)

- `ui/dialog` — modal primitive used by delete dialogs, rename, reassign
- `layout/theme-toggle` — header light/dark switch
- `cadences/cadence-rename-button` — small client island for the cadence
  detail page header
- `email/email-thread` — threaded email conversation view, wired into
  the lead detail Emails tab with reply mode
- `app/(dashboard)/admin` — dedicated admin page (separate from settings)
- `app/(dashboard)/forecast` — full forecast surface (covers what
  `rhythm/ForecastComparison` did)

## Pages

Every original page has a Next equivalent:

| Original | Port |
|---|---|
| LoginPage | `(auth)/login` |
| OAuthCallbackPage | `auth/callback` |
| GoogleAuthCallbackPage | `api/email/callback` route |
| DashboardPage | `(dashboard)/page.tsx` |
| LeadsPage | `(dashboard)/leads/page.tsx` |
| LeadDetailPage | `(dashboard)/leads/[id]/page.tsx` |
| ContactsPage | `(dashboard)/contacts/page.tsx` |
| CompaniesPage | `(dashboard)/companies/page.tsx` |
| CadencesPage | `(dashboard)/cadences/page.tsx` |
| CadenceDetailPage | `(dashboard)/cadences/[id]/page.tsx` |
| PipelinesPage | `(dashboard)/pipeline/page.tsx` |
| TasksPage | `(dashboard)/tasks/page.tsx` |
| CsvPage | `(dashboard)/csv/page.tsx` |
| SearchPage | `(dashboard)/search/page.tsx` |
| SettingsPage | `(dashboard)/settings/page.tsx` |

Plus port-only pages: `(dashboard)/admin`, `(dashboard)/forecast`,
`(dashboard)/rhythm`, `(dashboard)/companies/[id]`.

## Wiring status (the new components actually rendered somewhere)

| Component | Used at |
|---|---|
| LeadStageTransition | lead detail page |
| LeadTabs | lead detail page (Activities / Emails / Contacts / Tasks / Audit) |
| EmailThread | inside the LeadTabs Emails tab |
| FileUpload | inside the LeadTabs Activities tab |
| EmailSyncStatus | settings → Email tab |
| RankedLeadList | settings → Scoring tab |
| ChatbotToggle | dashboard Shell (floating bottom-right) |
| ThemeToggle | dashboard header |
| DealGapsPanel | rhythm page + dashboard panel |
| DealScoresPanel | rhythm page |
| CompanyDetailView | company detail page |
| DeleteCompanyDialog | company detail page |
| TaskReassign | task list ("Reassign" button per row) |
| AuditLogTable | LeadTabs Audit tab |
| Dialog primitive | 8 places (delete, rename, reassign…) |
| ScoreBadge | RankedLeadList |
| CadenceRenameButton | cadence detail header |
| CadenceNameDialog | (driven by CadenceRenameButton) |
| BarChart | dashboard PipelineMetricsPanel — pipeline value & open leads by stage |
| DateRangeFilter | dashboard PipelineMetricsPanel — date range form |
| FilterPanel | search page — lead-only stage / score / assignee / date filters |

## Backend additions (this port)

New API routes built to back the new UI:

- `POST /api/email/sync` — manual Gmail sync (queues Inngest event)
- `GET /api/email/threads/[leadId]` — grouped thread view
- `GET /api/pipelines` — multi-pipeline support hook
- `GET /api/leads/ranked` — top-scored open leads
- `GET /api/rhythm/priorities`
- `GET /api/rhythm/deal-scores`
- `GET /api/rhythm/deal-gaps`
- `POST/DELETE /api/contacts/link`
- `POST /api/ai/chat/execute` — chatbot action executor

New service additions:

- `unlinkContactFromLead` (services/contacts.ts)
- `updateStep`, `deleteStep` (services/cadences.ts)
- `executeChatAction` + `extractActionBlock` (services/ai.ts)

## CI / dev environment fixes

- **GitHub Actions migrate job** rewrote from `supabase db push`
  (no migrations folder) to `npx prisma migrate deploy`, gated on a
  `SUPABASE_DB_URL` secret so the job skips cleanly when not
  configured. Set the `SUPABASE_DB_URL` repo secret to enable
  automatic migrations on push to main.
- **Middleware** stopped 500-ing every request when Upstash / Supabase
  env vars were missing in dev. Rate-limit construction is now lazy
  and skips when Redis credentials aren't set; Supabase middleware
  helper returns `null` on missing public env vars instead of
  invoking `createServerClient(undefined, undefined)`.

## Chatbot — full action loop ✅

- Six action types (`navigate`, `create_lead`, `create_task`,
  `update_lead_status`, `update_lead_tier`, `enroll_in_cadence`)
- `[ACTION]{json}[/ACTION]` parser with backward-compatible
  `[NAVIGATE: /path]` legacy fallback
- Server-side executor in `services/ai.ts` with audit logging
- `POST /api/ai/chat/execute` route with `discriminatedUnion` Zod
  validation
- Auto-confirm switch in the header, labeled "Auto-run", with a
  hover tooltip explaining what it does. Mutating actions execute
  immediately when on; navigate actions always require an explicit
  click so users aren't redirected without intent.
- Follow-up "Open" link appears on success when the executor returns
  a path (e.g. the new lead's detail page)

## Known limits / not blockers

1. **Browser smoke test** — none of these features have been
   exercised in a running app with real Supabase / Gmail / AI
   credentials. Type-check and unit tests pass; runtime exposure
   needs hands-on testing.

## Tests

The original 852-test suite passes with the additions. New routes
and components are covered indirectly through type-check; adding
focused tests for the API routes added in this port is the most
useful next step for production deploy confidence.
