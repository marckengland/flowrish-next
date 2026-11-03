import http from 'node:http'
import net from 'node:net'

export function createReadOnlyProxy(targetOrigin, violation) {
  const target = new URL(targetOrigin)
  function destination(request) {
    try {
      const url = new URL(request.url, target)
      if (url.protocol === 'ws:') url.protocol = 'http:'
      if (
        url.origin === target.origin &&
        !url.username &&
        !url.password &&
        ['GET', 'HEAD'].includes(request.method)
      )
        return url
    } catch {
      /* Invalid or non-absolute proxy requests are denied. */
    }
    violation('Blocked browser destination or unmocked write')
    return null
  }
  const server = http.createServer((request, response) => {
    const url = destination(request)
    if (!url) {
      response.writeHead(403)
      response.end('Rehearsal network guard')
      return
    }
    const upstream = http.request(
      url,
      { method: request.method, headers: request.headers },
      (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers)
        incoming.pipe(response)
      },
    )
    upstream.on('error', () => {
      response.writeHead(502)
      response.end()
    })
    request.pipe(upstream)
  })
  server.on('connect', (request, socket) => {
    const host = new URL(`https://${request.url}`).hostname
    violation(`Blocked browser TLS tunnel: ${host}`)
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  })
  server.on('upgrade', (request, socket, head) => {
    const url = destination(request)
    if (!url || url.pathname !== '/_next/webpack-hmr') {
      socket.destroy()
      return
    }
    const upstream = net.connect(Number(target.port), target.hostname, () => {
      const headers = request.rawHeaders.reduce(
        (lines, value, i, all) =>
          i % 2 ? lines : lines + `${value}: ${all[i + 1]}\r\n`,
        '',
      )
      upstream.write(
        `${request.method} ${url.pathname}${url.search} HTTP/1.1\r\n${headers}\r\n`,
      )
      if (head.length) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
  })
  return server
}
