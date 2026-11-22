# Use Airish

Airish is Flowrish's in-app AI assistant. It can answer questions using the current workspace's permitted context, draft text, and propose supported CRM actions.

Open the assistant from the app. Use the intended business before asking a question, and keep **Autopilot** off when you want to review each action.

## Know what the response can do

| Response | What happens |
|----------|--------------|
| Plain answer or draft | Displays text; it is not an email send |
| Knowledge answer | Shows references for published passages supplied to the model |
| Table or chart | Presents structured figures; check them against their source |
| Navigation proposal | Opens the proposed app destination after confirmation, unless Autopilot is enabled |
| CRM action proposal | Can create a lead/task/cadence, change lead status/tier, or enroll a lead after confirmation, unless Autopilot is enabled |

Autopilot permits supported actions to run without a separate card click. The server still checks the session, permissions, and action inputs. Enrolling a lead in an active cadence can cause later scheduled emails; treating that as a harmless text-only action would be wrong.

For a supervised check, use synthetic data, leave Autopilot off, and review the proposed fields. Do not confirm a real CRM change merely to test the assistant's wording.

## Ask for a useful answer

Give Airish the question, relevant context, and the result you need. For example:

| Need | Example |
|------|---------|
| A comparison | “Compare these three supplied pipeline totals in a table. Explain the largest gap.” |
| A trend | “Plot these monthly values as a line chart and include the exact numbers.” |
| A short draft | “Draft a two-sentence follow-up. Do not send it.” |
| Missing data | “Tell me what information is missing before estimating this.” |
| A business fact | “What does our published service guide say about this request?” |

Airish should not invent CRM figures, prices, or guarantees to complete a visual. Verify important statements and calculations. A valid chart format does not establish that the model used the right figures.

## Tables, charts, and sources

The interface renders Markdown tables and bounded bar/line charts. Charts also expose exact values in a table. Unsupported or malformed chart data must not become executable page content.

Select a bar, line point, or category in the chart's table to filter that table. Select it again or choose **Show all** to clear the selection. Other plotted points remain visible for comparison. Plot controls and category buttons support the keyboard as well as a pointer or touch.

When the answer includes underlying rows, select a category and choose **View details** to inspect them. A chart with only aggregate figures explains that underlying rows were not supplied. These controls use data already in the answer. They do not query or filter live CRM records, navigate to leads, generate another answer, or approve an action. Selecting a chart preserves your message draft and pending action review.

For a chart with drill-down data, each point can optionally include a detail table:

```json
{
  "type": "bar",
  "title": "Supplied sample pipeline",
  "unit": "deals",
  "data": [{
    "label": "Qualified",
    "value": 2,
    "details": {
      "columns": ["Name", "Next step"],
      "rows": [["Maya Demo", "Review outline"], ["Luis Example", "Retry call"]]
    }
  }]
}
```

This example uses fictional data. Details must come from individual rows supplied in the conversation or reference context. An aggregate total does not establish which records belong to it. The schema permits up to six distinct columns and 20 rows per point. Column names have a 40-character limit; text cells have a 160-character limit. Numeric cells use the same finite range as plotted values. Each row must match the column count. The whole chart block retains its 16,000-character limit. Detail cells render as text, with no executable markup, links, or actions.

Selections stay local to each chart. Loading another chart dataset or reopening an answer resets the selection. Existing saved charts without detail rows remain supported.

Streaming can stop before a response finishes. Treat incomplete output as incomplete; retrying a request can consume additional provider allowance. Closing the stream attempts to cancel the upstream transport but cannot undo processing already accepted by the provider.

Published Library passages are retrieved through PostgreSQL full-text search. Drafts are excluded. A citation identifies the document title and revision supplied at that time; it is not a guarantee that an answer is correct or that the document remains published.

Knowledge text is handled as answer context, not authority to execute actions. See [business knowledge](BUSINESS_KNOWLEDGE.md) and [the knowledge data flow](DATA_FLOWS.md#business-knowledge-and-ai-answers).

## Provider settings and privacy

Workspace administrators configure the organization provider, model, encrypted key, and limits in **Settings → AI provider**. When no organization configuration exists, internal AI features may use the deployment fallback. A paused or exhausted configured organization provider does not silently switch to that fallback.

Requests can include permitted CRM context, conversation history, and relevant published knowledge. Only use a provider and information appropriate for that business. Switching businesses clears the active conversation pointer; it does not grant access to another workspace's history.

Saving configuration makes no model request. Asking a question or generating a draft can spend allowance. Read [AI provider settings](AI_PROVIDER_SETTINGS.md) for reservations, failure accounting, and explicit connection testing.

## When something fails

| Situation | What to do |
|-----------|------------|
| Allowance exhausted or provider paused | Ask an administrator to review status; do not switch to another business's key |
| Answer lacks a needed fact | Add or correct an appropriate Library document, then publish it |
| Published source changed | Ask again; an older answer cannot be recalled |
| Response interrupted | Keep useful text, but do not assume the answer or proposed action completed |
| Action denied or failed | Check current workspace/access and inspect the result before starting another action |
| Chart has missing or suspect values | Ask for the source values and compare the table |

## Related guides

[User guide](USER_MANUAL.md) · [Provider settings](AI_PROVIDER_SETTINGS.md) · [Business knowledge](BUSINESS_KNOWLEDGE.md) · [Architecture](ARCHITECTURE.md) · [Documentation index](README.md)
