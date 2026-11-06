import {expect,type Page} from '@playwright/test'

/** Open the disclosure before exercising an existing expanded-filter workflow. */
export async function revealFollowUpFilters(page:Page) {
 const toggle=page.getByRole('button',{name:'Filters',exact:true})
 await expect(toggle).toBeVisible()
 if(await toggle.getAttribute('aria-expanded')!=='true'&&await toggle.isEnabled())await toggle.click()
}
