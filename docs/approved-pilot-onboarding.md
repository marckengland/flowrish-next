# Approve a pilot workspace

Use the private [waitlist inbox](https://flowrish.marckengland.com/staff/waitlist) with an explicitly granted Flowrish staff account.

1. Open **Manage pilot invitation** for the signup.
2. Select **Preview pilot invitation** and check the recipient email.
3. Confirm approval, then select **Issue private pilot link**.
4. Copy the private link and share it manually with that person. Flowrish sends no message.

The link lasts seven days. Flowrish stores only its hash. Closing or reloading the panel hides the original link. If the response was lost, retrying returns invitation status without recovering or rotating the link. Revoke an unused invitation before issuing a replacement. An accepted invitation keeps its workspace receipt and cannot create another workspace.

The prospect opens the private link and signs in with the invited verified email. On another device, they must reopen the private link after sign-in. They enter their business name and workspace identifier, review the details, and explicitly create their own organization. The widget starts off. The invitation grants no Flowrish staff access and copies no business documents or AI credentials.

Accounts with existing workspace memberships need staff assistance. This flow does not change their default workspace. If a request has an uncertain outcome, select **Reload invitation status** before trying again. A successful creation returns its original receipt.

Our team will confirm pricing. Pilot approval makes no price, discount, or trial promise.

## Check the next setup step

Select **Check pilot setup progress** on a signup in the staff inbox. The panel loads only when requested. Use **Refresh pilot progress** to check again; it does not poll or change the customer's settings.

For a joined pilot, staff see business details saved, approved services/pricing guidance/FAQ categories, organization AI configured with limits, an allowed website saved, widget state, and the latest saved browser rehearsal review. Missing categories count as unfinished preparation in this staff checklist. This does not change the receptionist's enablement policy.

A rehearsal counts as passed only when it is finished, saved, and marked passed. A changed business version or configuration or any Library document updated after that report was saved requires another rehearsal. This is a saved review, not proof of live AI quality, connectivity, or the latest unsaved local simulation.

Progress resolves the workspace through the accepted pilot invitation and original owner's retained membership. It exposes no customer documents, conversation text, review notes, or credentials. Removed access makes progress unavailable. When staff access is revoked, the inbox clears prospect information as soon as a request detects the denial.

The suggested next step ends at manual review with the business. Checking progress never enables the widget or calls an AI provider. Detailed setup history and unsaved simulation tracking are deferred.

## Verify changes without providers

Run the repository checks in `AGENTS.md`, including `npm run test:receptionist:mocked`. The isolated browser suite covers onboarding and progress workflows using synthetic records and intercepted API calls. Use the runner summary for its current scenario count. It makes no authentication, email, database, or provider requests.

The additional database suite uses `vitest.pilot.config.ts` and requires `PILOT_TEST_DATABASE_URL` with the explicitly checked loopback dummy credentials. Prepare a disposable PostgreSQL container using the copied-schema and offline-SQL procedure in `AGENTS.md`. Never run `prisma db push` from this checkout.

Run the read-only progress projection tests separately with `vitest.pilot-progress.config.ts` against the same disposable schema. Do not run the two database suites concurrently because the onboarding suite checks global fixture counts.

## Roll back the release

A progress-only release needs a code revert; it changes no schema or stored data.

If pilot sign-in or creation fails, stop sharing links. Revert the application changes and redeploy the previous application. Keep the additive `WaitlistPilotInvite` table, its index, the Prisma model, and applied migration. Its restrictive references preserve accepted workspace receipts. The previous application does not read the table.

Prepare and test an application-only recovery patch against your own release in a clean checkout. Retain the additive invitation schema and accepted-workspace receipts, then deploy through the normal checks. Keep operational evidence outside the public repository.

Code rollback does not delete created organizations or undo links already shared. Revoke specific unused invitations through the staff panel before removing it, if needed. Do not drop invitation receipts, restore a whole database snapshot, edit an applied migration, or rewrite main's history.

Deferred paths include onboarding an existing workspace, account switching across workspaces, automatic delivery, bulk issuance, and full invitation-generation history. Live authentication and provider responses are outside mocked verification.
