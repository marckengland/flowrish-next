# User Manual

## Getting Started

### Sign Up / Login

1. Navigate to the app URL
2. On the login page, choose:
   - **Magic Link:** Enter your email, click "Send Magic Link", check your inbox
   - **Google OAuth:** Click "Continue with Google"
3. After authentication, you'll be redirected based on your account state

### First-Time User: Onboarding

If you're new (no organization membership), you'll land on the onboarding page with two options:

**Option A: Create an Organization**
1. Enter an organization name (e.g., "Acme Corp")
2. Enter a URL-safe slug (e.g., "acme-corp") — must be unique
3. Click "Create Organization"
4. You become the OWNER with full permissions
5. A default "General" team is created automatically
6. A default sales pipeline with 6 stages is created on your first lead

**Option B: Join via Invite**
1. Get an invite code from your team admin
2. Paste it in the "Join Organization" field
3. Click "Join"
4. You're added with the role specified in the invite

### Returning User

If you already have an organization, you're redirected straight to the dashboard.

---

## Dashboard

The dashboard is your home base with tabbed views:

- **Today's Rhythm** — Priority-sorted actions for the day
- **Team View** (Managers only) — Overdue counts and top 3 urgent items per rep
- **Deal Health** — Engagement scores with Healthy/At Risk/Critical classification
- **Deal Gaps** — Leads missing recent activity, future meetings, or multi-threading
- **Forecast** — Pipeline value, weighted pipeline, AI predicted
- **Commit vs AI** (Managers) — Your forecast commit compared to AI prediction
- **Pipeline Metrics** — Value per stage, conversion rates, stage duration, lead counts

---

## Leads

### Creating a Lead

1. Go to **Leads** in the sidebar
2. Click "New Lead"
3. Fill in required fields: First Name, Last Name, Stage
4. Optional: email, phone, deal value, company info
5. Click "Create"

The lead is automatically scoped to your organization. If no assignee is specified, assignment rules run automatically.

### Lead Detail Page

Click any lead to see:
- **Lead info** — Editable fields, stage, deal value, score
- **Activity Timeline** — All interactions (calls, meetings, notes, emails, files)
- **Conversation Intelligence** — AI meeting summaries (if meetings are logged)
- **Coaching Comments** — Manager feedback on activities

### Moving Leads Through Pipeline

- Use the **Pipeline** (Kanban) view to drag leads between stages
- Or use the stage dropdown on the lead detail page
- Moving to "Closed Won" or "Closed Lost" marks the lead as closed with a close date
- Moving back to an open stage reopens the lead

### Converting a Lead to Contact

1. On the lead detail page, click "Convert to Contact"
2. A Contact record is created from the lead's data
3. The lead moves to Closed Won
4. Any active cadence enrollments are exited

### Soft Delete

- Deleting a lead sets a `deletedAt` timestamp — it's hidden from all views
- MEMBER role users must submit a deletion request (approved by MANAGER/ADMIN)
- MANAGER/ADMIN can delete directly

---

## Pipeline (Kanban Board)

The pipeline view shows leads as cards in stage columns:
- Drag cards between columns to move leads through stages
- Cards show deal value and lead score
- MEMBER users only see their assigned leads
- MANAGER/ADMIN see all leads in their accessible teams

---

## Activities

Log interactions on any lead:

| Type | Fields |
|------|--------|
| Call | Call date, duration, notes |
| Meeting | Meeting date, attendees, notes |
| Note | Free-text notes |
| Email | Sent via Gmail integration |
| File | Upload attachment (max 25 MB) |

Each activity updates the lead's `lastActivityAt` timestamp, which feeds into scoring and rhythm.

---

## Tasks

- Create tasks linked to leads with a due date, priority (Low/Medium/High), and assignee
- Tasks are sorted by due date (most urgent first)
- Overdue tasks are highlighted
- Completing a task logs a "Task completed" activity on the lead

---

## Cadences (Sales Sequences)

### Creating a Cadence

1. Go to **Cadences** → "New Cadence"
2. Add steps (Email, Call, LinkedIn, Manual Task) with delays between them
3. Cadence starts in DRAFT status
4. Click "Activate" (requires at least one step)

### Enrolling Leads

- Single enroll: From the cadence detail page or lead detail
- Bulk enroll: Select multiple leads and enroll at once
- A lead can only have one ACTIVE enrollment per cadence

### Enrollment Lifecycle

```
ACTIVE → PAUSED → ACTIVE (resume)
ACTIVE → EXITED (manual exit, reply received, meeting booked)
ACTIVE → COMPLETED (all steps executed)
```

### Cadence Analytics

The cadence detail page shows:
- Total enrollments, active/completed/exited counts
- Completion rate and average completion time
- Per-step metrics (reached, completed, exited at each step)

---

## Email (Gmail Integration)

### Connecting Gmail

1. Go to **Settings** → Email
2. Click "Connect Gmail"
3. Authorize via Google OAuth
4. Your tokens are encrypted (AES-256-CBC) and stored securely

### Sending Emails

- Compose from the lead detail page
- Use personalization tags: `{{FirstName}}`, `{{LastName}}`, `{{FullName}}`, `{{CompanyName}}`, `{{Title}}`
- Tags are replaced with lead data before sending

### Email Sync

- Triggered on-demand to pull recent emails from Gmail
- Emails are matched to leads by email address
- Synced emails appear in the lead's activity timeline

---

## Lead Scoring

Leads are scored 0–100 based on configurable rules:
- Activity count
- Deal value
- Stage progression
- Email engagement

### Score Decay

A daily background job reduces scores for inactive leads:
- Configure inactivity threshold (days) and point reduction
- Leads inactive beyond the threshold lose points daily
- Scores are clamped to [0, 100]

---

## Rhythm Engine

The rhythm engine prioritizes your daily actions based on weighted signals:

| Signal | Weight | Max |
|--------|--------|-----|
| Overdue | +2/hour past due | 30 |
| Deal value | +1 per $5K | 20 |
| Lead score | +1 per 5pts above 50 | 15 |
| Inactivity | +1/day over 7 days | 15 |
| HIGH priority | +10 flat | 10 |

### Deal Health

Each deal gets an engagement score (1–100) based on:
- Activity recency (0–25)
- Stakeholder count (0–20)
- Activity volume in last 30 days (0–20)
- Deal progression through pipeline (0–20)
- Lead score (0–15)

Classification: **Healthy** (60+), **At Risk** (35–59), **Critical** (<35)

### Deal Gaps

Automatically identified issues:
- No activity in 7+ days
- No future meeting scheduled
- Single-threaded (≤1 contact linked)

---

## Revenue Forecasting

- **Total Pipeline:** Sum of all open deal values
- **Weighted Pipeline:** Deal value × stage win probability
- **AI Predicted:** 70% weighted + 30% monthly run rate (last 30 days closed won)
- **Forecast Submission:** Submit your commit amount for a YYYY-MM period
- **Risk Assessment:** On Track (<15% gap), At Risk (15–30%), High Risk (>30%)

Daily snapshots track pipeline trends over time.

---

## CSV Import/Export

### Import

1. Go to **CSV** → Import
2. Upload a CSV file
3. Map columns to lead fields (firstName, lastName, email, companyName, etc.)
4. Preview the first 5 rows
5. Click "Import"
6. Results: success count + skip count (invalid/duplicate rows)

Save field mappings for reuse on future imports.

### Export

- Click "Export" to download all accessible leads as CSV
- Respects RBAC — you only export leads you can see
- Soft-deleted leads are excluded

---

## Search

Full-text search across Leads, Contacts, and Companies using PostgreSQL tsvector:
- Type in the global search bar
- Results are ranked by relevance
- Filter by entity type, date range, or assigned user
- Soft-deleted leads are excluded

---

## AI Features

### Email Generation

- Click "Generate Email" on a lead
- AI uses lead context (name, title, company, last 5 interactions) + admin-configured system prompt
- Returns a structured draft (subject + body) you can edit before sending

### Account Research

- Click "Research" on a company
- AI returns: executive summary, strategic goals, sales angles, challenges

### Chatbot

- Accessible from every page via the sidebar
- Ask questions about your pipeline, get suggestions, analyze deals

---

## Admin & Settings

### User Management (ADMIN/OWNER)

- Invite users with specific roles and team assignments
- Manage existing members' roles
- View and manage teams (create, nest, assign members)

### Audit Log (ADMIN/OWNER)

- Immutable record of all create/update/delete operations
- Filter by entity type, user, date range
- Shows old/new values for updates

### Deletion Requests

- MEMBER users submit requests to delete leads/contacts
- MANAGER/ADMIN review and approve/reject
- Approved deletions execute immediately

### Scoring Rules

- Configure which signals contribute to lead scores
- Set weights and thresholds

### Assignment Rules

- TERRITORY: Match by company/region
- DEAL_SIZE: Match by min/max deal value range
- ROUND_ROBIN: Distribute evenly across team members

### AI Prompt Configuration

- Customize system prompts for email generation and account research
- Only active prompts are included in AI requests

---

## Roles & Permissions Reference

| Permission | OWNER | ADMIN | MANAGER | MEMBER |
|-----------|-------|-------|---------|--------|
| leads:read | ✓ | ✓ | ✓ | ✓ |
| leads:write | ✓ | ✓ | ✓ | ✓ |
| leads:delete | ✓ | ✓ | ✓ | — |
| contacts:read | ✓ | ✓ | ✓ | ✓ |
| contacts:write | ✓ | ✓ | ✓ | ✓ |
| cadences:manage | ✓ | ✓ | ✓ | — |
| cadences:read | ✓ | ✓ | ✓ | ✓ |
| users:invite | ✓ | ✓ | — | — |
| users:manage | ✓ | ✓ | — | — |
| billing:manage | ✓ | — | — | — |
| settings:manage | ✓ | ✓ | — | — |
| audit:read | ✓ | ✓ | — | — |
| forecast:read | ✓ | ✓ | ✓ | ✓ |
| forecast:submit | ✓ | ✓ | ✓ | — |
