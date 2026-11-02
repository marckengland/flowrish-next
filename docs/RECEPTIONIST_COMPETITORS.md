# Receptionist onboarding patterns

Research checked on November 2, 2026. The comparisons below describe vendor documentation and product claims. They are not independent call-quality, reliability, or conversion benchmarks.

## Competitor references

| Product | Documented setup and testing | Pattern for Flowrish |
|---|---|---|
| [Frontdesk setup](https://www.myaifrontdesk.com/help/getting-started/setup-wizard) and [Playground](https://www.myaifrontdesk.com/help/getting-started/testing) | Business information can come from text, a website, or uploaded documents. The configuration page tracks completion. The Playground offers browser audio, a phone test, and a shareable demo, depending on account access. Browser tests require voice credits and exclude SMS and transfers. | Show the next setup task, give admins a preview before phone activation, and state which channels the preview does not test. |
| [Rosie](https://heyrosie.com/) | Its setup sequence starts with a website or Google Business Profile, then asks the owner to review business information, customize the greeting, and test before forwarding calls. | Make review explicit. Use the business name entered for the workspace and show the resulting greeting before launch. |
| [Goodcall FAQ](https://www.goodcall.com/faq) and [knowledge guide](https://help.goodcall.com/en/articles/8007519-knowledge-skills-and-actions) | Goodcall documents a demo agent before a paid phone setup. Its knowledge editor pairs caller phrases with configured responses or actions and shows a sample interaction. | Make testing accessible before telephony spending. Keep reference information distinct from CRM actions and show how missing answers fall back to callback collection. |
| [Smith.ai AI receptionist](https://smith.ai/ai-receptionist) | Smith.ai describes a training environment, scenario practice, review of transcripts, and improvement suggestions before live activation. It also offers scheduling, integrations, and optional live-agent involvement. | Use representative test scenarios and inspect results before launch. Avoid treating a completed settings form as proof that the phone integration works. |

## Our immediate scope

Flowrish already has organization-specific business names, schedules, callback ownership, an approval-gated knowledge library, and transactional callback capture. The next change makes that setup easier to understand and adds a preview without a Twilio account.

The guided sequence is business details, approved knowledge, browser preview, then optional phone connection. A typed preview uses the same conversation state machine and current public-approved knowledge as incoming calls. Browser read-aloud is optional. Confirmation shows the callback details that a real call would create, but preview requests persist no leads, tasks, activities, call records, or transcripts.

This addresses our current budget and verification needs. It does not establish that Flowrish outperforms the competitors. They document capabilities we have not built or measured, including browser audio calls, website ingestion, advanced call transfers, calendars, multilingual service, and human escalation.

## What to evaluate later

Before adding more channels, test the behavior that matters to a business owner:

- Does the greeting use the correct saved business name after edits and workspace switches?
- Does a price answer come from the current approved source, with no private draft content?
- Does an unknown question produce a callback offer rather than an invented answer?
- Does the receptionist read back corrections and require explicit confirmation?
- Does a revoked source stop appearing in the next answer?
- Can an owner identify missing setup steps and distinguish preview success from a tested phone connection?

Website import would reduce typing, but it also introduces stale information, extraction errors, and external fetching. Keep imported material under the existing draft-and-approval process when that feature is considered. Human handoff, booking, voice recognition, latency, and carrier routing require their own acceptance tests.

## Budget constraint and phone testing

The user has not authorized a Twilio purchase or paid activation. [Twilio's trial documentation](https://www.twilio.com/docs/usage/trials) lists supported trial countries and does not list the Philippines. A free test using a Philippine phone number is therefore not promised. The browser preview adds no telephony charges and uses the existing AI provider, whose usage terms still apply.

Real incoming calls remain unverified until a supported voice account and incoming number are connected. No browser preview result should be presented as a successful real phone call.
