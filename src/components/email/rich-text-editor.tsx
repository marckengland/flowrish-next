'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { Mark, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AtSign,
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Palette,
  Paperclip,
  Strikethrough,
  Type,
  Underline as UnderlineIcon,
  Unlink,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { PERSONALIZATION_TAGS } from '@/lib/personalization-tags'

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
  /**
   * When false, the personalization tag UI (toolbar button, chip row,
   * autocomplete on `{{`, preview pane) is hidden. Defaults to true so
   * email/cadence body editors get the full experience without extra props.
   */
  enablePersonalization?: boolean
  /**
   * Called when the user drops or pastes files into the editor. The
   * parent decides what to do — typically appending them to an
   * outgoing email's attachment list. The default behaviour (no
   * handler supplied) is to do nothing so the editor doesn't try to
   * embed binary data into the document.
   */
  onFilesDropped?: (files: readonly File[]) => void
}

const FONT_OPTIONS = [
  { label: 'Default', value: 'sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' },
] as const

/**
 * Pixel font sizes the toolbar exposes. These values match the
 * inline-style `font-size` attribute the FontSize extension writes,
 * so the dropdown is a perfect round-trip with the editor's current
 * mark state.
 */
const FONT_SIZE_OPTIONS = [
  { label: 'Default', value: '' },
  { label: '12px', value: '12px' },
  { label: '14px', value: '14px' },
  { label: '16px', value: '16px' },
  { label: '18px', value: '18px' },
  { label: '20px', value: '20px' },
  { label: '24px', value: '24px' },
  { label: '28px', value: '28px' },
  { label: '32px', value: '32px' },
] as const

const COLOR_OPTIONS = [
  '#000000',
  '#374151',
  '#DC2626',
  '#EA580C',
  '#CA8A04',
  '#16A34A',
  '#2563EB',
  '#7C3AED',
  '#DB2777',
  '#6B7280',
] as const

/**
 * TipTap doesn't ship a font-size extension. We layer one on top of
 * the existing `TextStyle` mark — which is already loaded for color
 * and font-family — by augmenting it with a `fontSize` attribute and
 * exposing `setFontSize` / `unsetFontSize` commands.
 *
 * Storing the size as an inline `style="font-size: …"` keeps the
 * output compatible with email clients (the wrapper service still
 * inlines and sanitizes the body) without introducing a new mark.
 */
const FontSize = Mark.create<Record<string, never>>({
  name: 'fontSize',

  addOptions() {
    return {}
  },

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element) => {
          return (element as HTMLElement).style.fontSize || null
        },
        renderHTML: (attributes) => {
          if (!attributes.size) return {}
          return { style: `font-size: ${attributes.size}` }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        style: 'font-size',
        getAttrs: (value) => {
          if (!value) return false
          return { size: value }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) => {
          return chain().setMark('fontSize', { size }).run()
        },
      unsetFontSize:
        () =>
        ({ chain }) => {
          return chain().unsetMark('fontSize').run()
        },
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      /** Apply the given CSS font-size (e.g. "16px") to the selection. */
      setFontSize: (size: string) => ReturnType
      /** Clear any font-size mark on the selection. */
      unsetFontSize: () => ReturnType
    }
  }
}

/**
 * Rich text editor for email composition.
 *
 * Features:
 * - Bold / Italic / Underline / Strikethrough
 * - Bulleted and ordered lists
 * - Font family + font size + text color (popovers)
 * - Hyperlink (highlight text → add URL) and unlink
 * - Personalization tag insertion via toolbar button, chip row, and an
 *   inline autocomplete that fires when the user types `{{`. Suggestions
 *   support arrow-key navigation, Tab/Enter to commit, Escape to cancel.
 * - Optional preview pane that renders the body with sample tag values
 *   so users can sanity-check before sending.
 * - Optional drag-and-drop attachment forwarding via `onFilesDropped`
 *
 * Outputs clean HTML for the email render pipeline.
 */
export function RichTextEditor({
  defaultValue = '',
  onChange,
  placeholder = 'Write your email…',
  className,
  minHeight = '200px',
  enablePersonalization = true,
  onFilesDropped,
}: RichTextEditorProps): React.JSX.Element {
  const [tagState, setTagState] = useState<{
    open: boolean
    filter: string
    selected: number
  }>(() => ({ open: false, filter: '', selected: 0 }))
  const [isDragOver, setIsDragOver] = useState(false)

  const filteredTags = PERSONALIZATION_TAGS.filter((t) => {
    const q = tagState.filter.toLowerCase()
    return (
      t.label.toLowerCase().includes(q) || t.tag.toLowerCase().includes(q)
    )
  })

  const editor = useEditor({
    immediatelyRender: false,
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
      FontSize,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-blue-600 underline' },
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
      if (!enablePersonalization) return

      // Look back at the last few chars before the cursor to detect a
      // pending `{{xyz` token so we can show inline autocomplete.
      const text = e.state.doc.textBetween(
        Math.max(0, e.state.selection.from - 30),
        e.state.selection.from,
      )
      const match = text.match(/\{\{([^}]*)$/)
      if (match) {
        setTagState({ open: true, filter: match[1], selected: 0 })
      } else {
        setTagState((prev) =>
          prev.filter ? { open: false, filter: '', selected: 0 } : prev,
        )
      }
    },
  })

  const insertTag = useCallback(
    (tag: string) => {
      if (!editor) return
      const text = editor.state.doc.textBetween(
        Math.max(0, editor.state.selection.from - 30),
        editor.state.selection.from,
      )
      const match = text.match(/\{\{([^}]*)$/)
      if (match) {
        const deleteFrom = editor.state.selection.from - match[0].length
        editor
          .chain()
          .focus()
          .deleteRange({ from: deleteFrom, to: editor.state.selection.from })
          .insertContent(tag)
          .run()
      } else {
        editor.chain().focus().insertContent(tag).run()
      }
      setTagState({ open: false, filter: '', selected: 0 })
    },
    [editor],
  )

  // Keyboard navigation while the inline autocomplete is open.
  useEffect(() => {
    if (!enablePersonalization) return
    if (!tagState.open || !tagState.filter || !editor) return

    const list = filteredTags
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setTagState((prev) => ({
          ...prev,
          selected: Math.min(prev.selected + 1, list.length - 1),
        }))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setTagState((prev) => ({
          ...prev,
          selected: Math.max(prev.selected - 1, 0),
        }))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const candidate = list[tagState.selected]
        if (candidate) {
          e.preventDefault()
          insertTag(candidate.tag)
        }
      } else if (e.key === 'Escape') {
        setTagState({ open: false, filter: '', selected: 0 })
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [
    enablePersonalization,
    tagState.open,
    tagState.filter,
    tagState.selected,
    filteredTags,
    editor,
    insertTag,
  ])

  if (!editor) {
    return (
      <div
        className={cn(
          'animate-pulse rounded-[10px] border bg-muted',
          className,
        )}
        style={{ minHeight }}
      />
    )
  }

  /**
   * Drag-drop forwarding. We don't try to embed binary content in the
   * TipTap document — instead we hand the files up to the parent so
   * they can be added to the email's attachment list (or dropped on
   * the floor when the parent doesn't supply a handler).
   *
   * We deliberately call `preventDefault` only when a handler is
   * registered, otherwise the browser's native paste/drop behaviour
   * (e.g. dropping a text file as inline text) still works.
   */
  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!onFilesDropped) return
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault()
      setIsDragOver(true)
    }
  }
  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!onFilesDropped) return
    // Ignore drag-leaves that bubble up from children inside the panel.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setIsDragOver(false)
  }
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!onFilesDropped) return
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setIsDragOver(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onFilesDropped(files)
  }
  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    if (!onFilesDropped) return
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    onFilesDropped(files)
  }

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-[10px] border transition-colors',
        isDragOver && 'border-brand ring-1 ring-brand/30',
        className,
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <Toolbar
        editor={editor}
        enablePersonalization={enablePersonalization}
        tagPanelOpen={tagState.open && !tagState.filter}
        onToggleTagPanel={() =>
          setTagState((prev) =>
            prev.open && !prev.filter
              ? { open: false, filter: '', selected: 0 }
              : { open: true, filter: '', selected: 0 },
          )
        }
        onAttachFiles={onFilesDropped}
      />

      {/* Click-to-insert chips when the user opens the tag panel from the toolbar */}
      {enablePersonalization && tagState.open && !tagState.filter && (
        <div className="flex flex-wrap gap-1.5 border-b bg-muted/30 px-2 py-2">
          <span className="mr-1 self-center text-[10px] text-muted-foreground">
            Insert:
          </span>
          {PERSONALIZATION_TAGS.map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() => insertTag(t.tag)}
              className="rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium transition-colors hover:border-primary/30 hover:bg-primary/10"
              title={t.description}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <EditorContent editor={editor} />

        {editor.isEmpty && (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
            {placeholder}
          </p>
        )}

        {/* Drop overlay surfaces clearly when the user is dragging files in */}
        {isDragOver && onFilesDropped && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[10px] bg-brand-subtle text-sm font-medium text-brand-emphasis"
          >
            Drop files to attach
          </div>
        )}

        {/* Inline autocomplete dropdown — appears when the user types `{{` */}
        {enablePersonalization
          && tagState.open
          && tagState.filter
          && filteredTags.length > 0 && (
          <div
            role="listbox"
            className="absolute left-3 top-1 z-20 mt-8 w-64 overflow-hidden rounded-md border bg-popover shadow-lg"
          >
            <div className="border-b px-2 py-1 text-[10px] font-medium text-muted-foreground">
              Matching tags
            </div>
            {filteredTags.map((t, i) => (
              <button
                key={t.tag}
                type="button"
                role="option"
                aria-selected={i === tagState.selected}
                onClick={() => insertTag(t.tag)}
                onMouseEnter={() =>
                  setTagState((prev) => ({ ...prev, selected: i }))
                }
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors',
                  i === tagState.selected
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted',
                )}
              >
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                  {t.tag}
                </code>
                <span className="text-muted-foreground">{t.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {enablePersonalization && editor.getText().length > 0 && (
        <PreviewSection html={editor.getHTML()} />
      )}
    </div>
  )
}

interface ToolbarProps {
  editor: Editor
  enablePersonalization: boolean
  tagPanelOpen: boolean
  onToggleTagPanel: () => void
  /**
   * When supplied, the toolbar renders a paperclip button that opens
   * a native file picker. Selected files are forwarded straight to
   * the parent — same path used by drag-drop and paste — so the
   * editor itself never tries to embed binary content.
   */
  onAttachFiles?: (files: readonly File[]) => void
}

function Toolbar({
  editor,
  enablePersonalization,
  tagPanelOpen,
  onToggleTagPanel,
  onAttachFiles,
}: ToolbarProps) {
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [showFonts, setShowFonts] = useState(false)
  const [showColors, setShowColors] = useState(false)
  const [showSizes, setShowSizes] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const setLink = useCallback(() => {
    if (!linkUrl) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      const href = linkUrl.match(/^https?:\/\//)
        ? linkUrl
        : `https://${linkUrl}`
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    setShowLinkInput(false)
    setLinkUrl('')
  }, [editor, linkUrl])

  const currentFontSize =
    (editor.getAttributes('fontSize') as { size?: string } | undefined)?.size
    ?? ''

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-2 py-1">
      {/* Font family */}
      <Popover
        open={showFonts}
        onToggle={() => {
          setShowFonts((v) => !v)
          setShowColors(false)
          setShowSizes(false)
        }}
        trigger={
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Font family"
          >
            <Type className="size-3.5" />
            Font
          </button>
        }
      >
        <div className="flex flex-col">
          {FONT_OPTIONS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => {
                if (f.value === 'sans-serif') {
                  editor.chain().focus().unsetFontFamily().run()
                } else {
                  editor.chain().focus().setFontFamily(f.value).run()
                }
                setShowFonts(false)
              }}
              className="rounded px-3 py-1.5 text-left text-xs hover:bg-muted"
              style={{ fontFamily: f.value }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Popover>

      {/* Font size */}
      <Popover
        open={showSizes}
        onToggle={() => {
          setShowSizes((v) => !v)
          setShowFonts(false)
          setShowColors(false)
        }}
        trigger={
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Font size"
          >
            <span className="font-mono">A</span>
            <span className="text-[10px] tabular-nums">
              {currentFontSize || 'auto'}
            </span>
          </button>
        }
      >
        <div className="flex flex-col">
          {FONT_SIZE_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                if (option.value === '') {
                  editor.chain().focus().unsetFontSize().run()
                } else {
                  editor.chain().focus().setFontSize(option.value).run()
                }
                setShowSizes(false)
              }}
              className={cn(
                'rounded px-3 py-1.5 text-left text-xs hover:bg-muted',
                currentFontSize === option.value && 'bg-muted',
              )}
              style={{ fontSize: option.value || undefined }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Popover>

      <Divider />

      <ToolbarButton
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <Bold className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <Italic className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline"
      >
        <UnderlineIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <Strikethrough className="size-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Color picker */}
      <Popover
        open={showColors}
        onToggle={() => {
          setShowColors((v) => !v)
          setShowFonts(false)
          setShowSizes(false)
        }}
        trigger={
          <button
            type="button"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Text color"
          >
            <Palette className="size-3.5" />
          </button>
        }
      >
        <div className="grid grid-cols-5 gap-1">
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                editor.chain().focus().setColor(c).run()
                setShowColors(false)
              }}
              className="size-5 rounded-full border hover:ring-2 hover:ring-ring hover:ring-offset-1"
              style={{ backgroundColor: c }}
              title={c}
              aria-label={`Set text color to ${c}`}
            />
          ))}
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().unsetColor().run()
              setShowColors(false)
            }}
            className="col-span-5 mt-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
          >
            Reset color
          </button>
        </div>
      </Popover>

      <Divider />

      <ToolbarButton
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
      >
        <List className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
      >
        <ListOrdered className="size-3.5" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        active={editor.isActive('link')}
        onClick={() => {
          if (editor.isActive('link')) {
            // Surface unlink as the affordance when already on a link.
            // Users can still re-add via the unlink button below.
            editor.chain().focus().unsetLink().run()
            return
          }
          setShowLinkInput(true)
          setLinkUrl(editor.getAttributes('link').href ?? '')
        }}
        title={editor.isActive('link') ? 'Edit link' : 'Insert link'}
      >
        <LinkIcon className="size-3.5" />
      </ToolbarButton>
      {editor.isActive('link') && (
        <ToolbarButton
          active={false}
          onClick={() => editor.chain().focus().unsetLink().run()}
          title="Remove link"
        >
          <Unlink className="size-3.5" />
        </ToolbarButton>
      )}

      {showLinkInput && (
        <div className="ml-1 flex items-center gap-1">
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://…"
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
            onClick={() => {
              setShowLinkInput(false)
              setLinkUrl('')
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
      )}

      {enablePersonalization && (
        <>
          <Divider />
          <ToolbarButton
            active={tagPanelOpen}
            onClick={onToggleTagPanel}
            title="Insert personalization tag (or type {{ in the editor)"
          >
            <AtSign className="size-3.5" />
          </ToolbarButton>
        </>
      )}

      {onAttachFiles && (
        <>
          <Divider />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0) onAttachFiles(files)
              // Reset so picking the same file twice still fires onChange.
              e.target.value = ''
            }}
          />
          <ToolbarButton
            active={false}
            onClick={() => fileInputRef.current?.click()}
            title="Attach file (or drag & drop into the editor)"
          >
            <Paperclip className="size-3.5" />
          </ToolbarButton>
        </>
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
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
}

interface PopoverProps {
  open: boolean
  onToggle: () => void
  trigger: React.ReactNode
  children: React.ReactNode
}

/**
 * Tiny popover used for the font, size, and color toolbars. Closes
 * on outside click so each can be dismissed without committing a
 * selection.
 */
function Popover({ open, onToggle, trigger, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) {
        onToggle()
      }
    }
    // Defer registration so the click that opened the popover doesn't
    // immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onClick)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open, onToggle])

  return (
    <div ref={ref} className="relative">
      <div onClick={onToggle}>{trigger}</div>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 rounded-md border bg-popover p-2 shadow-lg">
          {children}
        </div>
      )}
    </div>
  )
}

function PreviewSection({ html }: { html: string }) {
  const [expanded, setExpanded] = useState(false)

  // Substitute each tag with a sample value, wrapped in a span so users
  // can visually distinguish replaced text from literal copy.
  let preview = html
  for (const t of PERSONALIZATION_TAGS) {
    const replacement = `<span class="text-ai font-medium">${t.sample}</span>`
    preview = preview
      .split(t.tag)
      .join(replacement)
  }

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <span className="font-medium">Preview</span>
        <span>{expanded ? '▲ Hide' : '▼ Show'}</span>
      </button>
      {expanded && (
        <div className="border-t bg-muted/20 px-3 py-2">
          <p className="mb-1.5 text-[10px] text-muted-foreground">
            Tags shown with sample data (purple text):
          </p>
          <div
            className="prose prose-sm max-w-none text-sm"
            // The preview HTML is computed from the editor's own output,
            // which TipTap already sanitizes — there is no untrusted
            // input path that reaches this render.
            dangerouslySetInnerHTML={{ __html: preview }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Returns the HTML content from the editor for use in email sending.
 * Kept for backward compatibility with the previous export shape; new
 * callers should bind to `defaultValue`/`onChange` directly.
 */
export function useRichTextEditor() {
  const [html, setHtml] = useState('')
  return { html, setHtml }
}
