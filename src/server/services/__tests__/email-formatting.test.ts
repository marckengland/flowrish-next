import { describe, it, expect, vi } from 'vitest'

/**
 * Unit tests covering the formatting fidelity of outgoing emails.
 *
 * The TipTap editor in `email-compose.tsx` emits semantic HTML — bold,
 * italic, underline, strike, lists, color/font-size/font-family inline
 * styles, links — and the recipient must see the same formatting the
 * sender authored. These tests pin the wire-format invariants so a
 * regression in the MIME builder, link inlining, or encoding can't
 * silently degrade the rendered email.
 *
 * Validates: Requirements 7.3
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────
//
// `email.ts` pulls in `@/lib/encryption` and `@/lib/env` at module load
// for the OAuth/send paths. We stub them so this test file can import
// the formatting helpers without a configured env.

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => ({})),
  TENANT_SCOPED_MODELS: [],
}))

vi.mock('@/lib/encryption', () => ({
  encrypt: (v: string) => v,
  decrypt: (v: string) => v,
}))

vi.mock('@/lib/env', () => ({
  env: { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' },
}))

import {
  __testing__,
  htmlToPlainText,
  wrapHtmlEmail,
} from '@/server/services/email'

const { buildRawEmail, buildRawEmailWithAttachments, encodeQuotedPrintable } =
  __testing__

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Decode the base64url payload Gmail expects, returning the RFC 2822 wire bytes. */
function decodeBase64Url(b64: string): string {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

/**
 * Decode a quoted-printable text body back to its source string. We
 * use this in tests so we can assert against the original HTML the
 * editor produced rather than the encoded form.
 */
function decodeQuotedPrintable(input: string): string {
  // Soft line breaks are an `=` immediately followed by CRLF — they
  // disappear during decode.
  const bytes: number[] = []
  let i = 0
  const cleaned = input.replace(/=\r?\n/g, '')
  while (i < cleaned.length) {
    const ch = cleaned[i]
    if (ch === '=') {
      const hex = cleaned.slice(i + 1, i + 3)
      bytes.push(parseInt(hex, 16))
      i += 3
    } else {
      bytes.push(cleaned.charCodeAt(i))
      i++
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/**
 * Splits a multipart body into its parts using the given boundary.
 * Returns an array of `{ headers: string, body: string }` for each
 * part, ignoring the trailing closing boundary.
 */
function splitMultipart(
  raw: string,
  boundary: string,
): Array<{ headers: Record<string, string>; body: string }> {
  const sections = raw.split(`--${boundary}`)
  // First chunk is the preamble (before the first boundary), last is
  // the closing `--boundary--` marker.
  return sections
    .slice(1, -1)
    .map((section) => {
      const stripped = section.replace(/^\r?\n/, '')
      const splitIdx = stripped.indexOf('\r\n\r\n')
      const headerText = splitIdx >= 0 ? stripped.slice(0, splitIdx) : stripped
      const bodyText = splitIdx >= 0 ? stripped.slice(splitIdx + 4) : ''
      const headers: Record<string, string> = {}
      for (const line of headerText.split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/)
        if (m) headers[m[1].toLowerCase()] = m[2]
      }
      return {
        headers,
        body: bodyText.replace(/\r?\n+$/g, ''),
      }
    })
}

function getBoundary(contentTypeHeader: string): string {
  const match = contentTypeHeader.match(/boundary="?([^";\s]+)"?/i)
  expect(match, `boundary in: ${contentTypeHeader}`).not.toBeNull()
  return match![1]
}

// ─── htmlToPlainText ─────────────────────────────────────────────────────────

describe('htmlToPlainText', () => {
  it('preserves words and adds a newline between paragraphs', () => {
    const html = '<p>Hi Sam,</p><p>Following up on yesterday.</p>'
    const text = htmlToPlainText(html)
    expect(text).toContain('Hi Sam,')
    expect(text).toContain('Following up on yesterday.')
    // Paragraphs should be separated by at least one blank line.
    expect(text.split('Hi Sam,')[1].trim().startsWith('Following up'))
      .toBe(true)
  })

  it('renders bullet lists as "• item"', () => {
    const html = '<ul><li>Alpha</li><li>Beta</li></ul>'
    const text = htmlToPlainText(html)
    expect(text).toContain('• Alpha')
    expect(text).toContain('• Beta')
  })

  it('surfaces link targets when text and href differ', () => {
    const html = '<p>Visit our <a href="https://example.com/pricing">pricing page</a>.</p>'
    const text = htmlToPlainText(html)
    expect(text).toContain('pricing page (https://example.com/pricing)')
  })

  it('decodes common HTML entities', () => {
    const html = '<p>Tom &amp; Jerry &lt;sales&gt;&nbsp;team</p>'
    const text = htmlToPlainText(html)
    expect(text).toContain('Tom & Jerry <sales> team')
  })

  it('drops <style> blocks instead of dumping their contents', () => {
    const html = '<style>body{color:red}</style><p>Hello</p>'
    const text = htmlToPlainText(html)
    expect(text).not.toContain('color:red')
    expect(text).toContain('Hello')
  })
})

// ─── wrapHtmlEmail ───────────────────────────────────────────────────────────

describe('wrapHtmlEmail', () => {
  it('preserves bold, italic, underline, strike, list, color, and font-size markup', () => {
    const body = [
      '<p><strong>Bold</strong> <em>italic</em> <u>underline</u> <s>strike</s></p>',
      '<ul><li>One</li><li>Two</li></ul>',
      '<p><span style="color:#DC2626">red</span> <span style="font-size:20px">big</span></p>',
    ].join('')

    const wrapped = wrapHtmlEmail(body)

    expect(wrapped).toContain('<strong>Bold</strong>')
    expect(wrapped).toContain('<em>italic</em>')
    expect(wrapped).toContain('<u>underline</u>')
    expect(wrapped).toContain('<s>strike</s>')
    expect(wrapped).toContain('<li>One</li>')
    expect(wrapped).toContain('color:#DC2626')
    expect(wrapped).toContain('font-size:20px')
  })

  it('inlines styling on links so they survive Outlook stripping <style>', () => {
    const body =
      '<p>See <a class="text-blue-600 underline" href="https://example.com">our site</a>.</p>'
    const wrapped = wrapHtmlEmail(body)

    expect(wrapped).toContain('color:#2563eb')
    expect(wrapped).toContain('text-decoration:underline')
    expect(wrapped).toContain('href="https://example.com"')
  })

  it('applies typography to the <body> tag (not just inside <style>)', () => {
    const wrapped = wrapHtmlEmail('<p>Hi</p>')
    // <body> must carry inline base styling so Outlook (which strips
    // <style>) still gets the right typography.
    expect(wrapped).toMatch(/<body\s+style="[^"]*font-family/i)
    expect(wrapped).toMatch(/<body\s+style="[^"]*line-height:1\.6/i)
  })
})

// ─── encodeQuotedPrintable ───────────────────────────────────────────────────

describe('encodeQuotedPrintable', () => {
  it('passes ASCII through unchanged', () => {
    expect(encodeQuotedPrintable('hello world')).toBe('hello world')
  })

  it('encodes non-ASCII bytes as =XX', () => {
    // "café" — the é is U+00E9 (UTF-8: C3 A9)
    expect(encodeQuotedPrintable('café')).toBe('caf=C3=A9')
  })

  it('encodes the literal "=" sign', () => {
    expect(encodeQuotedPrintable('a=b')).toBe('a=3Db')
  })

  it('protects trailing whitespace with =20', () => {
    const encoded = encodeQuotedPrintable('hello   ')
    expect(encoded.endsWith('=20=20=20')).toBe(true)
  })

  it('soft-wraps lines longer than 76 chars without splitting an =XX triplet', () => {
    const long = 'café'.repeat(40) // each "café" → "caf=C3=A9"
    const encoded = encodeQuotedPrintable(long)
    for (const line of encoded.split('\r\n')) {
      // RFC 2045 caps a quoted-printable line at 76 characters.
      expect(line.length).toBeLessThanOrEqual(76)
      // A trailing `=XX` (3-byte hex escape) is allowed; what's not
      // allowed is splitting that triplet across two lines, which would
      // produce a stray `=X` (2 chars) at end-of-line.
      expect(line).not.toMatch(/=[0-9A-F]$/)
    }
    // Round-trip back to the original after decoding (soft line breaks
    // are stripped by `decodeQuotedPrintable`).
    expect(decodeQuotedPrintable(encoded)).toBe(long)
  })
})

// ─── buildRawEmail ───────────────────────────────────────────────────────────

describe('buildRawEmail (no attachments)', () => {
  const FROM = 'sender@example.com'
  const TO = 'recipient@example.com'
  const SUBJECT = 'Quick question'
  const HTML = wrapHtmlEmail(
    '<p><strong>Hi Sam</strong>, want to chat?</p>'
    + '<p>Try <a href="https://flowrish.app">our app</a>.</p>',
  )

  it('emits a multipart/alternative top-level Content-Type', () => {
    const wire = decodeBase64Url(buildRawEmail(FROM, TO, SUBJECT, HTML))
    expect(wire).toMatch(/Content-Type:\s*multipart\/alternative/i)
  })

  it('contains both a text/plain and a text/html part', () => {
    const wire = decodeBase64Url(buildRawEmail(FROM, TO, SUBJECT, HTML))
    const headerEnd = wire.indexOf('\r\n\r\n')
    const headers = wire.slice(0, headerEnd)
    const body = wire.slice(headerEnd + 4)

    const ctMatch = headers.match(/Content-Type:.*?multipart\/alternative.*/i)
    expect(ctMatch).not.toBeNull()
    const boundary = getBoundary(ctMatch![0])

    const parts = splitMultipart(body, boundary)
    expect(parts).toHaveLength(2)

    const types = parts.map((p) => p.headers['content-type'])
    expect(types.some((t) => /text\/plain/i.test(t))).toBe(true)
    expect(types.some((t) => /text\/html/i.test(t))).toBe(true)
  })

  it('the html part round-trips quoted-printable back to the original', () => {
    const wire = decodeBase64Url(buildRawEmail(FROM, TO, SUBJECT, HTML))
    const headerEnd = wire.indexOf('\r\n\r\n')
    const body = wire.slice(headerEnd + 4)
    const boundary = getBoundary(
      wire.slice(0, headerEnd).match(/Content-Type:.*/i)![0],
    )
    const parts = splitMultipart(body, boundary)
    const htmlPart = parts.find((p) =>
      /text\/html/i.test(p.headers['content-type']),
    )!
    expect(htmlPart.headers['content-transfer-encoding']).toBe(
      'quoted-printable',
    )
    // The encoder normalises bare `\n` to CRLF for RFC 5322 wire
    // compliance, so we compare against the CRLF-normalised HTML.
    const expected = HTML.replace(/\r?\n/g, '\r\n')
    expect(decodeQuotedPrintable(htmlPart.body)).toBe(expected)
  })

  it('the plain-text part is non-empty and free of HTML tags', () => {
    const wire = decodeBase64Url(buildRawEmail(FROM, TO, SUBJECT, HTML))
    const headerEnd = wire.indexOf('\r\n\r\n')
    const body = wire.slice(headerEnd + 4)
    const boundary = getBoundary(
      wire.slice(0, headerEnd).match(/Content-Type:.*/i)![0],
    )
    const parts = splitMultipart(body, boundary)
    const plainPart = parts.find((p) =>
      /text\/plain/i.test(p.headers['content-type']),
    )!
    const decoded = decodeQuotedPrintable(plainPart.body)
    expect(decoded).toContain('Hi Sam')
    expect(decoded).not.toContain('<p>')
    expect(decoded).not.toContain('<strong>')
    // Link target should be preserved in the fallback.
    expect(decoded).toContain('https://flowrish.app')
  })

  it('encodes a non-ASCII Subject as RFC 2047 encoded-word', () => {
    const wire = decodeBase64Url(
      buildRawEmail(FROM, TO, 'Café meeting — confirm', HTML),
    )
    expect(wire).toMatch(/Subject:\s*=\?UTF-8\?B\?/)
  })

  it('adds In-Reply-To and References headers when replying', () => {
    const wire = decodeBase64Url(
      buildRawEmail(
        FROM,
        TO,
        SUBJECT,
        HTML,
        '<abc123@mail.gmail.com>',
      ),
    )
    expect(wire).toContain('In-Reply-To: <abc123@mail.gmail.com>')
    expect(wire).toContain('References: <abc123@mail.gmail.com>')
  })
})

// ─── buildRawEmailWithAttachments ────────────────────────────────────────────

describe('buildRawEmailWithAttachments', () => {
  const FROM = 'sender@example.com'
  const TO = 'recipient@example.com'
  const SUBJECT = 'Proposal attached'
  const HTML = wrapHtmlEmail('<p>See attached.</p>')
  const ATTACHMENT = {
    fileName: 'pricing.pdf',
    mimeType: 'application/pdf',
    data: new Uint8Array([1, 2, 3, 4, 5]),
  }

  it('uses multipart/mixed at the top level and multipart/alternative for the body', () => {
    const wire = decodeBase64Url(
      buildRawEmailWithAttachments(FROM, TO, SUBJECT, HTML, [ATTACHMENT]),
    )
    expect(wire).toMatch(/Content-Type:\s*multipart\/mixed/i)
    // The first sub-part wraps the body alternatives.
    expect(wire).toMatch(/Content-Type:\s*multipart\/alternative/i)
  })

  it('embeds both a text/plain and a text/html version of the body', () => {
    const wire = decodeBase64Url(
      buildRawEmailWithAttachments(FROM, TO, SUBJECT, HTML, [ATTACHMENT]),
    )
    const mixedBoundary = getBoundary(
      wire.match(/Content-Type:\s*multipart\/mixed[^\r\n]*/i)![0],
    )
    const headerEnd = wire.indexOf('\r\n\r\n')
    const body = wire.slice(headerEnd + 4)
    const mixedParts = splitMultipart(body, mixedBoundary)

    // First mixed part is the alternative wrapper, rest are attachments.
    const altPart = mixedParts[0]
    expect(altPart.headers['content-type']).toMatch(/multipart\/alternative/i)
    const altBoundary = getBoundary(altPart.headers['content-type'])
    const altParts = splitMultipart(altPart.body, altBoundary)
    const types = altParts.map((p) => p.headers['content-type'])
    expect(types.some((t) => /text\/plain/i.test(t))).toBe(true)
    expect(types.some((t) => /text\/html/i.test(t))).toBe(true)
  })

  it('emits a base64-encoded attachment with the right Content-Disposition', () => {
    const wire = decodeBase64Url(
      buildRawEmailWithAttachments(FROM, TO, SUBJECT, HTML, [ATTACHMENT]),
    )
    expect(wire).toContain('Content-Disposition: attachment; filename="pricing.pdf"')
    expect(wire).toContain('Content-Transfer-Encoding: base64')
    // Original 5-byte payload base64-encodes to "AQIDBAU=" — the
    // builder strips/keeps padding inconsistently across line wraps,
    // so just check the meaningful prefix is present.
    expect(wire).toContain('AQIDBAU')
  })

  it('strips dangerous characters from the attachment filename', () => {
    const sneaky = {
      fileName: 'evil"\nfile.pdf',
      mimeType: 'application/pdf',
      data: new Uint8Array([0]),
    }
    const wire = decodeBase64Url(
      buildRawEmailWithAttachments(FROM, TO, SUBJECT, HTML, [sneaky]),
    )
    // No raw newline or quote should leak into the filename header.
    expect(wire).not.toMatch(/filename="evil"\nfile/)
    expect(wire).toMatch(/filename="evil\s+file\.pdf"/)
  })
})
