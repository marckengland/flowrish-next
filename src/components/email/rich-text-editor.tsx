'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import { useState, useCallback } from 'react'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  Type,
  Palette,
} from 'lucide-react'

import { cn } from '@/lib/utils'

export interface RichTextEditorProps {
  /** Initial HTML content. */
  defaultValue?: string
  /** Called whenever the content changes. Returns HTML string. */
  onChange?: (html: string) => void
  /** Placeholder text when empty. */
  placeholder?: string
  /** Additional class for the wrapper. */
  className?: string
  /** Minimum height for the editor area. */
  minHeight?: string
}

const FONT_OPTIONS = [
  { label: 'Default', value: 'sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' },
]

const COLOR_OPTIONS = [
  { label: 'Default', value: '' },
  { label: 'Black', value: '#000000' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Purple', value: '#9333ea' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Gray', value: '#6b7280' },
]

/**
 * Rich text editor for email composition with basic formatting.
 *
 * Features:
 * - Bold, Italic, Underline
 * - Font family (Verdana, Georgia, Arial, Courier)
 * - Text color
 * - Hyperlink insertion (highlight text → add URL)
 * - Outputs clean HTML for email rendering
 */
export function RichTextEditor({
  defaultValue = '',
  onChange,
  placeholder = 'Write your email...',
  className,
  minHeight = '200px',
}: RichTextEditorProps): React.JSX.Element {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      Color,
      FontFamily,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline',
        },
      }),
    ],
    content: defaultValue,
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm max-w-none focus:outline-none px-3 py-2',
          'min-h-[var(--editor-min-height)]',
        ),
        style: `--editor-min-height: ${minHeight}`,
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange?.(e.getHTML())
    },
  })

  if (!editor) {
    return <div className="h-[200px] animate-pulse rounded-md border bg-muted" />
  }

  return (
    <div className={cn('flex flex-col rounded-md border', className)}>
      <Toolbar editor={editor} />
      <div className="relative">
        <EditorContent editor={editor} />
        {editor.isEmpty && (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
            {placeholder}
          </p>
        )}
      </div>
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  const setLink = useCallback(() => {
    if (!linkUrl) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: linkUrl })
        .run()
    }
    setShowLinkInput(false)
    setLinkUrl('')
  }, [editor, linkUrl])

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-2 py-1">
      {/* Bold */}
      <ToolbarButton
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <Bold className="size-3.5" />
      </ToolbarButton>

      {/* Italic */}
      <ToolbarButton
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <Italic className="size-3.5" />
      </ToolbarButton>

      {/* Underline */}
      <ToolbarButton
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline"
      >
        <UnderlineIcon className="size-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Font Family */}
      <select
        value={editor.getAttributes('textStyle').fontFamily ?? 'sans-serif'}
        onChange={(e) => {
          if (e.target.value === 'sans-serif') {
            editor.chain().focus().unsetFontFamily().run()
          } else {
            editor.chain().focus().setFontFamily(e.target.value).run()
          }
        }}
        className="h-6 rounded border-none bg-transparent px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        title="Font family"
      >
        {FONT_OPTIONS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      {/* Text Color */}
      <select
        value={editor.getAttributes('textStyle').color ?? ''}
        onChange={(e) => {
          if (!e.target.value) {
            editor.chain().focus().unsetColor().run()
          } else {
            editor.chain().focus().setColor(e.target.value).run()
          }
        }}
        className="h-6 rounded border-none bg-transparent px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        title="Text color"
      >
        {COLOR_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Link */}
      <ToolbarButton
        active={editor.isActive('link')}
        onClick={() => {
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run()
          } else {
            setShowLinkInput(true)
            setLinkUrl(editor.getAttributes('link').href ?? '')
          }
        }}
        title="Insert link"
      >
        <LinkIcon className="size-3.5" />
      </ToolbarButton>

      {/* Link URL input */}
      {showLinkInput && (
        <div className="flex items-center gap-1 ml-1">
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
            className="h-6 w-40 rounded border bg-background px-1.5 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                setLink()
              }
              if (e.key === 'Escape') {
                setShowLinkInput(false)
                setLinkUrl('')
              }
            }}
            autoFocus
          />
          <button
            type="button"
            onClick={setLink}
            className="rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground"
          >
            Set
          </button>
          <button
            type="button"
            onClick={() => { setShowLinkInput(false); setLinkUrl('') }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'rounded p-1 transition-colors',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Returns the HTML content from the editor for use in email sending.
 */
export function useRichTextEditor() {
  const [html, setHtml] = useState('')
  return { html, setHtml }
}
