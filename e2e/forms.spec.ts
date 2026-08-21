import { test, expect, type Page } from '@playwright/test'

/**
 * Core "create" form flows.
 *
 * These exercise the highest-traffic write paths (lead, contact, company,
 * task, cadence + cadence step) as the authed test user. Every test seeds
 * an ellipsis / ".." into a free-text field, which is the exact class of
 * input that the old `sanitizedString` path-traversal rule falsely
 * rejected with "Path traversal detected". So besides catching 500s and
 * broken forms, this suite is a permanent regression guard for that bug.
 *
 * NOTE: these tests create real rows in the test tenant (prefixed "E2E "
 * with a timestamp so they're identifiable). Cleanup is out of scope here;
 * run against a disposable test org. Each test skips gracefully when the
 * current user lacks the relevant write permission or prerequisite data,
 * mirroring the existing smoke suite.
 */

/** Unique, identifiable suffix that deliberately contains a ".." sequence. */
function stamp(): string {
  return `.. ${Date.now()}${Math.floor(Math.random() * 1000)}`
}

/**
 * Fails if a validation-error alert is showing — with an extra-loud
 * message when it's the specific false-positive we fixed.
 */
async function expectNoValidationError(page: Page): Promise<void> {
  const alerts = page.getByRole('alert')
  const count = await alerts.count()
  for (let i = 0; i < count; i++) {
    const text = (await alerts.nth(i).textContent())?.trim() ?? ''
    expect(
      /path traversal|invalid input/i.test(text),
      `A form rejected valid input containing "..". This is the validator ` +
        `false-positive regression. Alert text: "${text}"`,
    ).toBe(false)
  }
}

test.describe('create forms accept ordinary text (incl. "..")', { tag: '@write' }, () => {
  test('create a lead with dot sequences in text fields', async ({ page }) => {
    await page.goto('/leads/new')

    const firstName = page.locator('input[name="firstName"]')
    if (!(await firstName.isVisible().catch(() => false))) {
      test.skip(true, 'Lead create form not available for this user')
    }

    // Bail out if the org has no pipeline stages — the form can't submit.
    const stage = page.locator('select[name="stageId"]')
    const stageOptionValues = await stage.locator('option').evaluateAll(
      (opts) =>
        (opts as HTMLOptionElement[])
          .filter((o) => !o.disabled && o.value !== '')
          .map((o) => o.value),
    )
    if (stageOptionValues.length === 0) {
      test.skip(true, 'No pipeline stages in the test tenant')
    }

    await firstName.fill('E2E')
    await page.locator('input[name="lastName"]').fill(`Lead${stamp()}`)
    await page.locator('input[name="title"]').fill('Follow up.. next week')

    await page.getByRole('button', { name: /^Create lead$/i }).click()

    // Success navigates to the new lead's detail page.
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/i, { timeout: 15_000 })
    await expectNoValidationError(page)
  })

  test('create a contact with dot sequences in text fields', async ({ page }) => {
    await page.goto('/contacts')

    const openBtn = page.getByRole('button', { name: /New contact/i })
    if (!(await openBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Contact create not available for this user')
    }
    await openBtn.click()

    await page.locator('input[name="firstName"]').fill('E2E')
    await page.locator('input[name="lastName"]').fill(`Contact${stamp()}`)
    await page.locator('input[name="jobTitle"]').fill('VP.. of Sales')

    const submit = page.getByRole('button', { name: /^Create Contact$/i })
    await submit.click()

    // On success the inline panel closes: submit button detaches and the
    // "New contact" trigger returns.
    await expect(submit).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: /New contact/i })).toBeVisible()
    await expectNoValidationError(page)
  })

  test('create a company with dot sequences in text fields', async ({ page }) => {
    await page.goto('/companies')

    const openBtn = page.getByRole('button', { name: /New company/i })
    if (!(await openBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Company create not available for this user')
    }
    await openBtn.click()

    await page.locator('input[name="name"]').fill(`E2E Co${stamp()}`)
    await page.locator('input[name="industry"]').fill('Software.. / SaaS')

    const submit = page.getByRole('button', { name: /^Create Company$/i })
    await submit.click()

    await expect(submit).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: /New company/i })).toBeVisible()
    await expectNoValidationError(page)
  })

  test('create a task with dot sequences in the title', async ({ page }) => {
    await page.goto('/tasks')

    const title = page.locator('input[name="title"]')
    if (!(await title.isVisible().catch(() => false))) {
      test.skip(
        true,
        'Task create form not available (no write permission or no leads)',
      )
    }

    const unique = `E2E task${stamp()}`
    await title.fill(unique)
    // dueDate is required and has no default — fill a far-future date.
    await page.locator('input[name="dueDate"]').fill('2030-01-01T09:00')

    await page.getByRole('button', { name: /^Create Task$/i }).click()

    // The form stays mounted; success shows the new task in the list.
    await expectNoValidationError(page)
    await expect(page.getByText(unique).first()).toBeVisible({ timeout: 15_000 })
  })

  test('create a cadence and add an email step with a ".." subject', async ({
    page,
  }) => {
    await page.goto('/cadences')

    const openBtn = page.getByRole('button', { name: /New cadence/i })
    if (!(await openBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Cadence create not available for this user')
    }
    await openBtn.click()

    await page.locator('input[name="name"]').fill(`E2E Cadence${stamp()}`)
    await page.getByRole('button', { name: /^Create cadence$/i }).click()

    // Lands on the new cadence detail page.
    await expect(page).toHaveURL(/\/cadences\/[0-9a-f-]{36}$/i, {
      timeout: 15_000,
    })
    await expectNoValidationError(page)

    // Overview defaults to the List builder, which has an "Add step" button.
    const addStep = page.getByRole('button', { name: /^Add step$/i })
    if (!(await addStep.isVisible().catch(() => false))) {
      test.skip(true, 'Add step control not available (cannot manage cadence)')
    }
    await addStep.click()

    // EMAIL is the default action type; fill the subject with a ".." string.
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('#step-subject').fill('Quick question.. about {Company}')

    // The dialog's own submit is also labelled "Add step".
    await dialog.getByRole('button', { name: /^Add step$/i }).click()

    // Success closes the dialog; the step is persisted.
    await expect(dialog).toBeHidden({ timeout: 15_000 })
    await expectNoValidationError(page)
  })
})
