'use strict'
// Isolated parser process: no application credentials, bounded heap and parent timeout.
console.log = console.warn = console.error = () => {}
const chunks = []
let bytes = 0
process.stdin.on('data', chunk => {
  bytes += chunk.length
  if (bytes > 2 * 1024 * 1024) process.exit(1)
  chunks.push(chunk)
})
process.stdin.on('end', async () => {
  const finish = value => process.stdout.write(JSON.stringify(value), () => process.exit(0))
  try {
    const buffer = Buffer.concat(chunks)
    globalThis.fetch = async () => { throw new Error('External resources are disabled') }
    let text
    if (process.argv[2] === 'pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getDocumentProxy, extractText } = require(process.argv[3])
      const pdf = await getDocumentProxy(new Uint8Array(buffer), { isEvalSupported: false, useSystemFonts: false, disableFontFace: true, maxImageSize: 0, useWorkerFetch: false, disableAutoFetch: true, disableStream: true })
      try {
        if (pdf.numPages > 100) return finish({ error: 'limit' })
        text = (await extractText(pdf, { mergePages: true })).text
      } finally { await pdf.loadingTask.destroy() }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require(process.argv[4])
      // extractRawText uses the reader's default externalFileAccess:false.
      text = (await mammoth.extractRawText({ buffer })).value
    }
    if (typeof text !== 'string' || text.length > 100000) return finish({ error: 'limit' })
    finish({ text })
  } catch { finish({ error: 'unreadable' }) }
})
