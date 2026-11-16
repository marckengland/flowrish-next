# Airish answer quality implementation plan

> **For agentic workers:** Implement inline with superpowers:executing-plans. Preserve every existing assertion and network guard.

**Goal:** Make Airish answers clear and readable, with useful tables and charts grounded in supplied data. Verify actual OpenAI output when an authorized API credential is available.

**Architecture:** Retain the existing OpenAI-compatible service and streaming protocol. Extract the existing escaped Markdown renderer, add native tables, and render a strict chart-data schema through React/SVG. Keep sources and action confirmation separate from model text.

**Tech stack:** Existing Next.js, React, Zod, Vitest and Playwright. No dependency changes.

**Spec:** User request in this conversation, November 16: test AI with OpenAI credits; answers should use charts/tables where useful, avoid filler, and use clear, plain language. Existing restrictions retain widget off, no DeepSeek, no real emails.

## Decisions and tradeoffs

- Native tables and bounded bar/line charts cover comparisons and trends without adding a charting dependency. This makes richer interactive charts a separate future change.
- Charts accept only title, optional unit and up to 12 labeled numeric values; no executable HTML or JavaScript. Text and exact-value tables remain readable when graphics fail.
- Visuals are appropriate for supplied figures, not mandatory for greetings, drafts or short answers. Missing CRM figures must be requested, never fabricated.
- Mock tests are deterministic regressions. Live AI checks require a separately supplied OpenAI API credential and bounded requests using synthetic data only. They never exercise production database writes or action execution.

## Review focus

- Incomplete streaming output must not leave a finished reply saying it is still preparing a chart.
- Model-provided markup and links must remain inert except safe HTTP links.
- Replayed history and knowledge answers must retain source and action safety.
- Mobile charts/tables must fit the sidebar and remain keyboard readable.
- Tests and live evaluations must not reach DeepSeek, email, or production data.

## Tasks

- [x] Extract and test the existing Markdown behavior; demonstrate failed table/chart tests before implementing them.
- [x] Add strict chart data and accessible native SVG/data tables. Test malformed, partial, signed and fractional data.
- [x] Add plain-language and supplied-data rules to all Airish answer paths; preserve action and reference boundaries.
- [x] Add an isolated browser fixture using the actual sidebar and streamed responses. Cover mobile/desktop, history reload, streaming, failure and explicit action review without executing actions.
- [ ] Run bounded live OpenAI checks if credentials are supplied. Inspect output quality and display actual answers in the browser fixture.
- [ ] Run full tests, build, lint, strict and fast types, and the full guarded browser rehearsal. Obtain one independent review, verify rollback, commit/push and follow authorized release verification.

## Completion

This task ends when this fixed quality pass and release verification finish. Live provider checks remain explicitly unverified if no API credential is available. No unrelated features are part of this pass.

## Evidence and current limit

The unit run passed 3,052 tests across 464 files. The browser rehearsal passed all 350 scenarios, including the existing 344. The production build and focused OpenAI request-shape tests passed. Independent review found no actionable issues. Final release verification is recorded separately.

Live OpenAI response quality is not verified: no OpenAI API credential was available in the workspace, and the request for its configured location is pending. No substitute provider was called. The bounded live evaluation is prepared privately with synthetic inputs and an eight-request ceiling; it is outside normal CI.
