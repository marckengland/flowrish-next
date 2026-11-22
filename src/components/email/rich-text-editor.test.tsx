import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { expect, it, vi } from 'vitest'
import { RichTextEditor } from './rich-text-editor'

it('handles autocomplete keys only inside its editor, including while its pane is hidden', () => {
  const onChange = vi.fn()
  const { container } = render(<div>
    <div data-testid="editor-pane"><RichTextEditor onChange={onChange} /></div>
    <button type="button">Other tab</button>
  </div>)
  const editable = container.querySelector<HTMLElement>('[contenteditable=true]')!
  const editor = (editable as HTMLElement & { editor: Editor }).editor
  act(() => { editor.commands.insertContent('{{fi') })
  expect(screen.getByRole('listbox')).toBeVisible()
  const otherTab = screen.getByRole('button', { name: 'Other tab' })
  act(() => { otherTab.focus() })
  const before = editor.getHTML()
  for (const hidden of [false, true]) {
    screen.getByTestId('editor-pane').hidden = hidden
    for (const key of ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape']) {
      expect(fireEvent.keyDown(otherTab, { key })).toBe(true)
      expect(editor.getHTML()).toBe(before)
    }
  }
  screen.getByTestId('editor-pane').hidden = false
  expect(fireEvent.keyDown(editable, { key: 'Tab' })).toBe(false)
  expect(editor.getText()).toBe('{{FirstName}}')
  expect(onChange).toHaveBeenLastCalledWith('<p>{{FirstName}}</p>')
})
