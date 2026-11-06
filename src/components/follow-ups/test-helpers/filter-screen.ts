import {fireEvent,screen} from '@testing-library/react'

/** Enter the filter disclosure before exercising an existing expanded-filter workflow. */
export function filterScreen() {
 const toggle=screen.getByRole('button',{name:/^Filters$/})
 if(toggle.getAttribute('aria-expanded')!=='true'&&!toggle.hasAttribute('disabled'))fireEvent.click(toggle)
 return screen
}
