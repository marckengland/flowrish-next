import { describe, expect, it, vi } from 'vitest'
import { SETUP_HISTORY_EVENT, SETUP_HISTORY_SCRIPT } from './receptionist-setup-history'
describe('setup history bridge before application routing', () => {
  it('runs a mounted guard before later router listeners and is inert after cleanup', () => {
    window.eval(SETUP_HISTORY_SCRIPT)
    const router = vi.fn(), guard = (event: Event) => { (event as CustomEvent<PopStateEvent>).detail.stopImmediatePropagation() }
    window.addEventListener('popstate', router); window.addEventListener(SETUP_HISTORY_EVENT, guard)
    window.dispatchEvent(new PopStateEvent('popstate')); expect(router).not.toHaveBeenCalled()
    window.removeEventListener(SETUP_HISTORY_EVENT, guard); window.dispatchEvent(new PopStateEvent('popstate')); expect(router).toHaveBeenCalledTimes(1)
    window.removeEventListener('popstate', router)
  })
})
