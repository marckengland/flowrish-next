import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { getDocumentProxy } from 'unpdf'
import mammoth from 'mammoth'
import { AppError } from '@/lib/errors'

const maxBytes = 2 * 1024 * 1024
const maxCharacters = 100000
const unsupported = () => new AppError('UNSUPPORTED_KNOWLEDGE_FILE', 'Use a TXT, Markdown, CSV, text-based PDF, or DOCX file.', 400)
const invalid = () => new AppError('INVALID_KNOWLEDGE_FILE', 'The document could not be read safely. Export it as plain text and try again.', 400)
const limit = () => new AppError('KNOWLEDGE_FILE_LIMIT', 'Use a document under 2 MB, 100 PDF pages, and 100,000 extracted characters.', 400)

function validateDocx(buffer: Buffer): void {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw invalid()
  let end = -1
  for (let position = buffer.length - 22; position >= Math.max(0, buffer.length - 65557); position--) {
    if (buffer.readUInt32LE(position) === 0x06054b50 && position + 22 + buffer.readUInt16LE(position + 20) === buffer.length) { end = position; break }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0) throw invalid()
  const entries = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), offset = buffer.readUInt32LE(end + 16)
  if (!entries || entries > 256 || entries !== buffer.readUInt16LE(end + 8) || offset + size !== end) throw invalid()
  const names = new Set<string>()
  let position = offset, total = 0
  for (let entry = 0; entry < entries; entry++) {
    if (position + 46 > end || buffer.readUInt32LE(position) !== 0x02014b50) throw invalid()
    const flags = buffer.readUInt16LE(position + 8), method = buffer.readUInt16LE(position + 10), compressed = buffer.readUInt32LE(position + 20), expanded = buffer.readUInt32LE(position + 24)
    const nameLength = buffer.readUInt16LE(position + 28), extra = buffer.readUInt16LE(position + 30), comment = buffer.readUInt16LE(position + 32), local = buffer.readUInt32LE(position + 42)
    if (position + 46 + nameLength + extra + comment > end || flags & 1 || ![0, 8].includes(method) || expanded > 4 * 1024 * 1024 || expanded > Math.max(1024, compressed * 100)) throw limit()
    let name: string
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(position + 46, position + 46 + nameLength)) } catch { throw invalid() }
    if (!name || /[\\\u0000-\u001f]/.test(name) || name.startsWith('/') || name.split('/').includes('..') || names.has(name)) throw invalid()
    names.add(name)
    total += expanded
    if (total > 12 * 1024 * 1024 || local + 30 > offset || buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) & 1 || buffer.readUInt16LE(local + 8) !== method) throw limit()
    const localNameLength = buffer.readUInt16LE(local + 26), localExtra = buffer.readUInt16LE(local + 28), start = local + 30 + localNameLength + localExtra
    if (start + compressed > offset || buffer.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name) throw invalid()
    let data: Buffer
    try { data = method === 8 ? inflateRawSync(buffer.subarray(start, start + compressed), { maxOutputLength: 4 * 1024 * 1024 }) : buffer.subarray(start, start + compressed) } catch { throw limit() }
    if (data.length !== expanded || (/\.xml$|\.rels$/i.test(name) && /<!DOCTYPE|<!ENTITY/i.test(data.toString('utf8')))) throw invalid()
    position += 46 + nameLength + extra + comment
  }
  if (position !== end || !names.has('[Content_Types].xml') || !names.has('word/document.xml')) throw invalid()
}

async function parseDocument(bytes: Uint8Array, format: 'pdf' | 'docx'): Promise<string> {
  // Static imports are traced; file parsing happens only in the bounded child.
  if (typeof getDocumentProxy !== 'function' || typeof mammoth.extractRawText !== 'function') throw invalid()
  const resolver = process.getBuiltinModule('node:module').createRequire(join(process.cwd(), 'package.json'))
  const paths = [resolver.resolve('unpdf'), resolver.resolve('mammoth')]
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=192', join(process.cwd(), 'src/server/services/knowledge-parser-worker.cjs'), format, ...paths], { env: { NODE_ENV: 'production' }, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', settled = false
    const finish = (error?: Error, text?: string) => { if (settled) return; settled = true; clearTimeout(timer); child.kill('SIGKILL'); if (error) reject(error); else resolve(text ?? '') }
    const timer = setTimeout(() => finish(new AppError('KNOWLEDGE_PARSE_TIMEOUT', 'Document extraction timed out. Export a smaller plain-text document and try again.', 400)), 15000)
    child.on('error', () => finish(invalid()))
    child.stdin.on('error', () => finish(invalid()))
    child.stderr.on('data', () => {})
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { output += chunk; if (Buffer.byteLength(output) > 500000) finish(limit()) })
    child.on('close', code => {
      if (settled) return
      if (code !== 0) return finish(invalid())
      try { const result = JSON.parse(output) as { text?: string; error?: string }; if (result.error) return finish(result.error === 'limit' ? limit() : invalid()); if (typeof result.text !== 'string') return finish(invalid()); finish(undefined, result.text) } catch { finish(invalid()) }
    })
    child.stdin.end(bytes)
  })
}

export async function extractKnowledgeFile(input: { name: string; type: string; bytes: Uint8Array }): Promise<{ contentText: string; sourceName: string; sourceMime: string; warnings: string[] }> {
  if (!input.name || input.name.length > 200 || /[\\/\u0000-\u001f]/.test(input.name)) throw unsupported()
  if (!input.bytes.length) throw invalid()
  if (input.bytes.length > maxBytes) throw limit()
  const extension = input.name.split('.').at(-1)?.toLowerCase()
  const types: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  if (!extension || !types[extension]) throw unsupported()
  const mime = input.type.split(';')[0].trim().toLowerCase()
  if (mime && mime !== 'application/octet-stream' && mime !== types[extension] && !(['txt', 'md', 'markdown', 'csv'].includes(extension) && mime.startsWith('text/'))) throw unsupported()
  let text: string
  const warnings: string[] = []
  if (extension === 'pdf') {
    if (!/^%PDF-\d\.\d/.test(Buffer.from(input.bytes.subarray(0, 8)).toString('ascii'))) throw invalid()
    text = await parseDocument(input.bytes, 'pdf')
    warnings.push('PDF extraction reads embedded text only. Review all prices and tables; scanned pages and images are not read with OCR.')
  } else if (extension === 'docx') {
    validateDocx(Buffer.from(input.bytes))
    text = await parseDocument(input.bytes, 'docx')
    warnings.push('DOCX text was extracted without images or formatting. Review tables and prices before publishing.')
  } else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes) } catch { throw invalid() }
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw invalid()
  const contentText = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!contentText) throw new AppError('KNOWLEDGE_NO_TEXT', 'No readable text was found. Scanned PDFs need OCR first; upload a text-based PDF, DOCX, TXT, Markdown, or CSV document.', 400)
  if (contentText.length > maxCharacters) throw limit()
  return { contentText, sourceName: input.name, sourceMime: types[extension], warnings }
}
