import {expect,type Page} from '@playwright/test'

/** Enter details before exercising an existing expanded-card workflow. No requests. */
export async function revealFollowUpDetails(page:Page) {
 await expect(page.getByRole('article').first()).toBeVisible()
 for(const card of await page.getByRole('article').all()) {
  const button=card.getByRole('button',{name:'Review follow-up',exact:true})
  if(await button.count() && await button.isEnabled())await button.click()
 }
}
