# User Manual

## Getting Started

### Sign Up / Login

1. Navigate to the app URL
2. On the login page, choose:
   - **Magic Link:** Enter your email, click "Send Magic Link", check your inbox
   - **Google OAuth:** Click "Continue with Google"
3. After authentication, you'll be redirected based on your account state

### First-Time User: Onboarding

If you're new (no organization membership), you'll land on the onboarding page:

**Option A: Create an Organization**
1. Enter an organization name (e.g., "Acme Corp")
2. Enter a URL-safe slug (e.g., "acme-corp") — must be unique
3. Click "Create Organization"
4. You become the OWNER with full permissions
5. A default "General" team and sales pipeline are created automatically

**Option B: Join via Invite**
1. Get an invite code from your team admin
2. Paste it in the "Join Organization" field
3. Click "Join"
4. You're added with the role specified in the invite

### Returning User

Redirected straight to the dashboard. If you previously started but didn't finish onboarding, you'll be sent back to complete it.

---

## Dashboard

The dashboard is your home base with tabbed views:

- **Today's Rhythm** — Priority-sorted actions for the day (overdue tasks highlighted)
- **Team View** (Managers only) — Overdue counts and top 3 urgent items per rep
- **Deal Health** — Engagement scores with Healthy/At Risk/Critical classification
- **Deal Gaps** — Leads missing recent activity, future meetings, or multi-threading
- **Forecast** — Pipeline value, weighted pipeline, AI predicted, win rate
- **Commit vs AI** (Managers) — Your forecast commit compared to AI prediction with risk level
- **Pipeline Metrics** — Value per stage, conversion rates, stage duration (with date range filter)

---

## Leads

### Creating a Lead

1. Go to **Leads** in the sidebar
2. Click "New Lead"
3. Fill in required fields: First Name, Last Name, Stage
4. Optional: email, phone, deal value, company info
5. Click "Create"

If no assignee is specified, **assignment rules** run automatically to assign the lead based on territory, deal size, or round-robin distribution.

### Lead Detail Page

Click any lead to see:
- **Lead info** — Editable fields, stage, deal value, score
- **Activity Timeline** — All interactions (calls, meetings, notes, emails, files)
- **Conversation Intelligence** — AI meeting summaries
- **Coaching Comments** — Manager feedback on activities
- **Duplicate Detection** — See potential duplicates and merge them (see below)

### Moving Leads Through Pipeline

- Use the **Pipeline** (Kanban) view to drag leads between stages
- Moving to "Closed Won" or "Closed Lost" marks the lead as closed with a close date
- Moving back to an open stage reopens the lead

### Converting a Lead to Contact

1. On the lead detail page, click "Convert to Contact"
2. A Contact record is created from the lead's data
3. The lead moves to Closed Won
4. Any active cadence enrollments are automatically exited

### Duplicate Detection & Merge

On the lead detail page, the system can detect potential duplicates:

1. Duplicates are identified by matching email address or company name
2. When duplicates are found, they're displayed on the lead detail page
3. Click "Merge" to combine two leads:
   - Choose which lead is the **primary** (keeps its data)
   - The secondary lead's activities and contacts are transferred to the primary
   - Duplicate contacts (same email) are skipped
   - The secondary lead is soft-deleted

### Soft Delete & Deletion Requests

- **MANAGER/ADMIN/OWNER:** Can delete leads directly (sets `deletedAt` timestamp, hidden from all views)
- **MEMBER:** Cannot delete directly — must submit a **deletion request**:
  1. On the lead detail page, click "Request Deletion"
  2. Optionally provide a reason
  3. An admin reviews and approves or rejects the request
  4. If approved, the lead is soft-deleted

---

## Pipeline (Kanban Board)

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
| Email | Sent via Gmail integration (rich text) |
| File | Upload attachment (max 25 MB) |

Each activity:
- Updates the lead's `lastActivityAt` timestamp
- Triggers automatic **lead score recalculation**
- Feeds into the rhythm engine's priority scoring

---

## Tasks

- Create tasks linked to leads with a due date, priority (Low/Medium/High), and assignee
- Tasks are sorted by due date (most urgent first)
- Overdue tasks are highlighted in the rhythm dashboard
- Completing a task automatically logs a "Task completed" activity on the lead

---

## Cadences (Sales Sequences)

### Creating a Cadence

1. Go to **Cadences** → "New Cadence"
2. Add steps with delays between them:
   - **Email** — Sends an email to the lead (with rich text editor)
   - **Call** — Creates a high-priority call task for the rep
   - **LinkedIn** — Creates a LinkedIn outreach task
   - **Manual Task** — Creates a custom task for the rep
3. Cadence starts in DRAFT status
4. Click "Activate" (requires at least one step)

### Email Threading in Cadences

When a cadence has multiple EMAIL steps, follow-up emails are automatically sent as **replies in the same Gmail thread**:

- The first EMAIL step creates a new email thread
- Subsequent EMAIL steps use `Re:` prefix and reference the original thread ID
- This means the lead sees all cadence emails as a single conversation in their inbox
- Threading is tracked via the `emailThreadId` field on each enrollment

### Enrolling Leads

- Single enroll: From the cadence detail page or lead detail
- Bulk enroll: Select multiple leads and enroll at once
- A lead can only have one ACTIVE enrollment per cadence

### Enrollment Lifecycle

```
ACTIVE → PAUSED → ACTIVE (resume)
ACTIVE → EXITED (manual exit, reply received, meeting booked, lead converted)
ACTIVE → COMPLETED (all steps executed)
```

### What Happens When a Step Executes

| Step Type | Action |
|-----------|--------|
| EMAIL | Sends email (threaded), creates EMAIL activity on timeline |
| CALL | Creates a high-priority task "Make a call" assigned to the rep |
| LINKEDIN | Creates a medium-priority task "LinkedIn outreach" assigned to the rep |
| MANUAL_TASK | Creates a task with the configured title/description |

### Cadence Analytics

- Total enrollments, active/completed/exited counts
- Completion rate and average completion time
- Per-step metrics (reached, completed, exited at each step)

---

## Email (Gmail Integration)

### Connecting Gmail

1. Go to **Settings** → Email
2. Click "Connect Gmail"
3. Authorize via Google OAuth (uses `NEXT_PUBLIC_GOOGLE_CLIENT_ID` for the browser-side flow)
4. Tokens are encrypted (AES-256-CBC) and stored securely

### Rich Text Email Compose

The email editor supports full rich text formatting:

| Feature | Description |
|---------|-------------|
| **Bold** | `Ctrl+B` or toolbar button |
| **Italic** | `Ctrl+I` or toolbar button |
| **Underline** | `Ctrl+U` or toolbar button |
| **Headings** | H1, H2, H3 levels |
| **Lists** | Bullet and numbered lists |
| **Links** | Insert/edit clickable URLs |
| **Font Family** | Choose from multiple fonts |
| **Text Color** | Color picker for text |
| **Blockquotes** | Indented quote blocks |
| **Code** | Inline code formatting |

The editor produces clean HTML that renders consistently across email clients.

### File Attachments

- Click the attachment icon in the compose toolbar
- Upload files (max 25 MB per file)
- Attachments are included with the sent email

### Personalization Tags

Use these tags in your email — they're replaced with lead data before sending:

| Tag | Replaced With |
|-----|--------------|
| `{{FirstName}}` | Lead's first name |
| `{{LastName}}` | Lead's last name |
| `{{FullName}}` | Lead's full name |
| `{{CompanyName}}` | Lead's company name |
| `{{Title}}` | Lead's job title |

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

**Scores are automatically recalculated** whenever an activity is logged on a lead.

### Score Decay

A daily background job reduces scores for inactive leads:
- Configure inactivity threshold (days) and point reduction
- Leads inactive beyond the threshold lose points daily
- Scores are clamped to [0, 100]
- ScoreHistory entries track all changes

---

## Assignment Rules

When a lead is created without an assignee, assignment rules are evaluated automatically:

| Rule Type | How it works |
|-----------|-------------|
| TERRITORY | Matches lead's company/region against configured patterns |
| DEAL_SIZE | Matches lead's deal value against min/max range |
| ROUND_ROBIN | Distributes evenly across configured team members (Redis counter) |

Rules are evaluated in priority order (lowest number first). First match wins.

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

Each deal gets an engagement score (1–100):
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
- **AI Predicted:** 70% weighted + 30% monthly run rate
- **Forecast Submission:** Submit your commit amount for a YYYY-MM period
- **Risk Assessment:** On Track (<15% gap), At Risk (15–30%), High Risk (>30%)

Daily snapshots track pipeline trends over time.

---

## CSV Import/Export

### Import

1. Go to **CSV** → Import
2. Upload a CSV file
3. Map columns to lead fields
4. Preview the first 5 rows
5. Click "Import"

Features:
- Automatic duplicate detection (by email, case-insensitive)
- Company creation/reuse by name
- Save field mappings for reuse
- Results: success count + skip count (invalid/duplicate rows)

### Export

- Downloads all accessible leads as CSV
- Respects RBAC — you only export leads you can see
- Soft-deleted leads are excluded

---

## Search

Full-text search across Leads, Contacts, and Companies using PostgreSQL tsvector:
- Results ranked by relevance
- Filter by entity type, date range, or assigned user
- Soft-deleted leads excluded

---

## AI Features

### Email Generation

- AI uses lead context (name, title, company, last 5 interactions) + admin-configured system prompt
- Returns structured draft (subject + body) you can edit in the rich text editor before sending

### Account Research

- Returns: executive summary, strategic goals, sales angles, challenges

### Airish (AI chatbot assistant)

- Open **Airish** from the button in the top bar (available on every dashboard page); it slides in as a side panel
- Ask questions about your pipeline and get suggestions
- Airish can propose actions (navigate, update a lead's status/tier, enroll a lead, draft a cadence, …). By default each action asks for confirmation before it runs
- **Autopilot** — toggle it on and Airish executes proposed actions immediately without asking for per-action confirmation. Toggle it off to review each action again

---

## Admin (Owner/Admin only)

### User Management

- Invite users with specific roles and team assignments
- Privilege escalation prevention (can't invite with higher role than yours)
- View and manage existing members
- Remove members from the organization

### Custom Roles & Permissions

Navigate to **Admin → Roles & Permissions** tab:

**Viewing Roles:**
- See all system roles (OWNER, ADMIN, MANAGER, MEMBER) and custom roles
- Each role shows its hierarchy level and assigned permissions

**Creating a Custom Role:**
1. Click "Create Role"
2. Enter a role name (must be unique within the org)
3. Set the hierarchy level (lower = more powerful; cannot be more powerful than your own)
4. Toggle permissions on/off using the permission checkboxes
5. Click "Save"

**Editing a Role:**
- System roles: can modify permissions only (cannot rename or change hierarchy)
- Custom roles: can modify name, hierarchy, and permissions
- Click a role → edit its settings → save

**Deleting a Custom Role:**
- Only custom roles can be deleted
- Cannot delete a role that has team members assigned (reassign them first)
- System roles (OWNER, ADMIN, MANAGER, MEMBER) cannot be deleted

### Transfer Ownership

1. Go to **Admin → Members**
2. Click "Transfer Ownership"
3. Select the target member
4. Confirm the transfer
5. The target becomes OWNER; you are downgraded to ADMIN

Only the current OWNER can perform this action.

### Leave Organization

1. Go to **Admin → Members** (or Settings)
2. Click "Leave Organization"
3. Confirm

You cannot leave if you're the last OWNER — transfer ownership first.

### Team Management

- Create teams with parent-child hierarchy
- Assign members to teams with roles
- Users must be org members before joining teams

### Audit Log

- Immutable record of all create/update/delete operations
- Filter by entity type, user, date range, action
- Shows old/new values for updates

### Deletion Requests

- View pending deletion requests from MEMBER users
- Approve: executes the deletion (soft-delete for leads, hard delete for contacts/tasks)
- Reject: marks the request as rejected, no action taken

### Assignment Rules

- Configure TERRITORY, DEAL_SIZE, and ROUND_ROBIN rules
- Set priority order and enable/disable rules

### AI Prompt Configuration

- Customize system prompts for email generation and account research

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
| admin:users | ✓ | ✓ | — | — |
| admin:settings | ✓ | ✓ | — | — |
| billing:manage | ✓ | — | — | — |
| audit:read | ✓ | ✓ | — | — |
| forecast:read | ✓ | ✓ | ✓ | ✓ |
| forecast:submit | ✓ | ✓ | ✓ | — |

> **Note:** Custom roles can have any combination of these permissions. The table above shows the defaults for system roles.

> **Migration note:** The permissions `users:manage` and `settings:manage` have been renamed to `admin:users` and `admin:settings` respectively. If you see the old names in your database, run the migration SQL (see Setup Guide).


---

## Calling a lead

Open any lead → the **Call** card (right rail). If the number is present, click
**Call**:

- **Default (free):** launches your device dialer / softphone via `tel:`.
- **In-browser (if your org connected Twilio):** the call is placed inside
  Flowrish with an **End call** button.

Either way a timer runs; pick an **Outcome** (Connected, Left voicemail, No
answer, …), adjust the auto-filled **Duration**, add **Notes**, and **End & log
call** — it's saved to the lead's activity timeline.

Admins connect a calling provider in **Settings → Calling & voice** (see the
[Integrations Guide](INTEGRATIONS.md)).

## Connecting email (Gmail or Outlook)

**Settings → Email**:

- **Gmail** — click *Connect Gmail* and authorize.
- **Microsoft 365 / Outlook** — click *Connect Outlook* (once your admin has
  registered the Azure app; otherwise setup instructions are shown).

Once connected you can send from lead pages and cadences, and your inbox
replies sync into the timeline. Sending, threading, and cadence steps work the
same regardless of provider.

## Migrating from another CRM

Sidebar → **Import / Export** → the **Migrating from another CRM?** card. Choose
Salesforce, HubSpot, Pipedrive, or Other for step-by-step export instructions
and a column-mapping cheat sheet, then upload your CSV through the importer.
Companies are auto-created, contacts linked, and duplicates skipped.
