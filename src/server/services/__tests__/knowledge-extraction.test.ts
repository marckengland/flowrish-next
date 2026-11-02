import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractKnowledgeFile } from '../knowledge-extraction'

function crc32(data: Buffer): number { let value = 0xffffffff; for (const byte of data) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0) } return (value ^ 0xffffffff) >>> 0 }
function docx(text: string): Buffer {
  const files: Record<string, string> = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  }
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0
  for (const [name, value] of Object.entries(files)) { const filename = Buffer.from(name), raw = Buffer.from(value), compressed = deflateRawSync(raw); const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(filename.length, 26); locals.push(local, filename, compressed); const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(crc32(raw), 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42); central.push(entry, filename); offset += local.length + filename.length + compressed.length }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...locals, directory, end])
}
function pdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`; const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`]; let output = '%PDF-1.4\n'; const offsets = [0]; for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${object}\nendobj\n` } const xref = Buffer.byteLength(output); output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`; return Buffer.from(output)
}

describe('knowledge file extraction', () => {
  it.each([['pricing.txt', 'text/plain'], ['pricing.md', 'text/markdown'], ['pricing.csv', 'text/csv']])('extracts editable UTF-8 text from %s', async (name, type) => {
    const result = await extractKnowledgeFile({ name, type, bytes: Buffer.from('Service,Price\nConsultation,99') })
    expect(result.contentText).toBe('Service,Price\nConsultation,99')
    expect(result.sourceName).toBe(name)
  })
  it('extracts actual PDF text rather than requiring a preview or OCR', async () => {
    const result = await extractKnowledgeFile({ name: 'pricing.pdf', type: 'application/pdf', bytes: pdf('Consultation costs 99 dollars.') })
    expect(result.contentText).toContain('Consultation costs 99 dollars.')
    expect(result.warnings.join(' ')).toMatch(/text|scan|image/i)
  }, 20000)
  it('extracts actual DOCX paragraphs as plain text', async () => {
    const result = await extractKnowledgeFile({ name: 'services.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docx('We offer consultations for 99 dollars.') })
    expect(result.contentText).toContain('We offer consultations for 99 dollars.')
    expect(result.contentText).not.toContain('<w:')
  }, 20000)
  it('preserves multibyte text across large parser output chunks', async () => {
    const text = Array.from({ length: 30000 }, (_, index) => String.fromCharCode(0x4e00 + index % 15000)).join('')
    const result = await extractKnowledgeFile({ name: 'unicode.docx', type: 'application/octet-stream', bytes: docx(text) })
    expect(result.contentText).toBe(text)
  }, 20000)
  it.each([
    { name: 'file.xlsx', type: 'application/octet-stream', bytes: Buffer.from('anything') },
    { name: '../pricing.txt', type: 'text/plain', bytes: Buffer.from('price') },
    { name: 'file.txt', type: 'text/plain', bytes: Buffer.from([0xff, 0xfe, 0, 0]) },
    { name: 'file.txt', type: 'text/plain', bytes: Buffer.from('binary\u0000content') },
    { name: 'file.pdf', type: 'application/pdf', bytes: Buffer.from('Not a PDF') },
    { name: 'file.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: Buffer.from('Not a ZIP') },
    { name: 'file.txt', type: 'text/plain', bytes: Buffer.from(' ') },
    { name: 'file.txt', type: 'text/plain', bytes: Buffer.alloc(2 * 1024 * 1024 + 1, 65) },
    { name: 'file.txt', type: 'text/plain', bytes: Buffer.from('x'.repeat(100001)) },
  ])('rejects unsupported, invalid or oversized input: $name', async input => { await expect(extractKnowledgeFile(input)).rejects.toThrow() })
  it('rejects a compressed DOCX bomb before parsing', async () => { await expect(extractKnowledgeFile({ name: 'bomb.docx', type: 'application/octet-stream', bytes: docx('x'.repeat(3_000_000)) })).rejects.toThrow() })
  it('rejects image-only/empty PDF extraction with an actionable message', async () => { await expect(extractKnowledgeFile({ name: 'scan.pdf', type: 'application/pdf', bytes: pdf('') })).rejects.toThrow(/text|OCR|scan/i) }, 20000)
})
export { docx, pdf }
