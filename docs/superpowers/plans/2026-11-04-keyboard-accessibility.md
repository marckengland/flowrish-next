# Keyboard and accessibility pass

> **For agentic workers:** Use superpowers:executing-plans inline, with one final fresh review.

**Goal:** Reproduce and fix keyboard/focus and form-description problems in lead/task forms, dialogs, primary navigation and business switching.

**Spec:** User approved a focused WAI-ARIA keyboard/accessibility pass, confirmed fixes, all mocked checks and merge if needed. No dependencies, widget activation, DeepSeek, production business records or emails.

**Architecture:** Keep existing UI primitives and native controls. Add eight guarded browser journeys using real components, plus focused unit regressions. An exact fixture-only auth-client replacement throws if invoked; real Supabase/database/server imports remain forbidden. Existing assertions and scenarios remain intact. This is not a compliance certification or a screen-reader compatibility survey.

**Constraints:** Preserve unrelated `.serena/` and `.spec-workflow/`. Ask before correcting an existing test. Use Node 22 and configured checks. Strict and fast types follow the root build. No schema, secrets, permissions or deployment-setting changes.

**Review focus:** Dialog rerenders must preserve input focus; Escape/Tab belong to the top dialog; hidden/negative-tabindex controls must not enter the tab loop; closed mobile navigation must not receive keyboard focus while desktop navigation remains visible; server validation descriptions must refer to rendered elements. Keep the browser fixture's credential/network/write guards intact.

## Task 1: Reproduce and verify the focused fixes

- [x] Add failing dialog unit regressions and eight browser journeys for dialog editing/nesting, lead/task labels/errors/priority keys, and navigation/native business switching. Record actual failures before product edits.
- [x] Fix confirmed issues in existing primitives and form markup. Retain native controls and current validation/persistence behavior.
- [x] Run narrow checks, then full tests, lint, build, strict/fast types and the expanded mocked browser rehearsal. Capture desktop/mobile evidence. Get a fresh review; cover material findings with failing-then-passing regressions.
Integration procedure: prove a normal code reversal restores the baseline application tree, commit, merge and check the merged suite under existing session authorization.

Release procedure: push and verify CI, Vercel's release gate and automatic production smoke. Confirm widget-off via read-only metadata. Do not log in or exercise live writes/providers.

## Baseline and rollback

Baseline `3065b5d73f56b3469cf0810edf53fc96c3d869c6`. A normal code revert restores the UI and original test selection/count. No external settings or stored data change. Keep the existing production gates. Do not restore a database snapshot, edit migration history, or enable the widget to test these fixes.

## Limits

The pass covers Chromium keyboard behavior and accessible names/descriptions in the listed workflows. Native date editing, assistive-technology speech output, other browser engines, and unrelated application pages are not certified by this pass. Later changes to the shared dialog/focus helpers need the same browser regressions.

Local evidence: the original 56 browser scenarios passed before product edits. New dialog and task-error regressions failed first, then passed. Two added boundary cases reproduced editable-note exclusion and the resize trap before their fixes. All 2,057 tests, lint, build, strict and fast types passed; the expanded 64-scenario browser rehearsal passed with zero guard violations, including the stronger closed/open drawer geometry checks. The native-select input correction was approved and retained all assertions. No existing test assertions were weakened.
