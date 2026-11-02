import 'server-only'
import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError } from '@/lib/errors'
import { websiteOriginSchema, type WebsiteRequestContext } from '@/lib/website-receptionist'
import { renderWebsiteReceptionistHtml } from '@/lib/website-receptionist-html'
import { getWebsiteReceptionistEmbed } from './website-receptionist'

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }
const unavailable = 'Website receptionist is unavailable. Please reload or contact the business directly.'
const publicCodes = new Set(['WEBSITE_UNAVAILABLE', 'WEBSITE_LIMIT_REACHED', 'WEBSITE_TOO_SOON', 'WEBSITE_PENDING', 'WEBSITE_CONFLICT', 'WEBSITE_SESSION_EXPIRED', 'WEBSITE_CHAT_CLOSED'])
function status(error: unknown) { return error instanceof ZodError ? 400 : error instanceof AppError && [400, 403, 404, 409, 410, 413, 429, 503].includes(error.statusCode) ? error.statusCode : 503 }
function invalid(code = 'VALIDATION_ERROR', statusCode = 400): never { throw new AppError(code, unavailable, statusCode) }

export async function readWebsiteBody(request: Request): Promise<unknown> {
  const max = 8192
  if (Number(request.headers.get('content-length')) > max) invalid('PAYLOAD_TOO_LARGE', 413)
  const reader = request.body?.getReader()
  if (!reader) invalid()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0, text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) { await reader.cancel(); invalid('PAYLOAD_TOO_LARGE', 413) }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } catch (error) { if (error instanceof AppError) throw error; invalid() }
  finally { reader.releaseLock() }
  try { return JSON.parse(text) } catch { invalid() }
}

function requestContext(request: Request): WebsiteRequestContext {
  const origin = new URL(request.url).origin
  if (request.headers.get('origin') !== origin) invalid('WEBSITE_UNAVAILABLE', 403)
  const ip = (request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  if (!isIP(ip)) invalid('WEBSITE_UNAVAILABLE', 403)
  return { ip, origin }
}

export async function publicWebsiteResponse(request: Request, needsToken: boolean, action: (body: unknown, context: WebsiteRequestContext, token: string) => Promise<unknown>) {
  try {
    const context = requestContext(request)
    const bearer = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')
    if (needsToken && !bearer) invalid('WEBSITE_UNAVAILABLE', 403)
    return NextResponse.json({ data: await action(await readWebsiteBody(request), context, bearer?.[1] ?? '') }, { headers })
  } catch (error) {
    const code = error instanceof AppError && publicCodes.has(error.code) ? error.code : status(error) === 400 ? 'VALIDATION_ERROR' : status(error) === 413 ? 'PAYLOAD_TOO_LARGE' : 'WEBSITE_UNAVAILABLE'
    return NextResponse.json({ error: { code, message: unavailable } }, { status: status(error), headers })
  }
}

export async function websiteEmbedResponse(request: Request, publicId: string) {
  const embedHeaders = { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()' }
  try {
    const query = new URL(request.url).searchParams
    if ([...query.keys()].length !== 1 || query.getAll('origin').length !== 1) invalid()
    const origin = websiteOriginSchema.parse(query.get('origin'))
    const data = await getWebsiteReceptionistEmbed(publicId, origin)
    const nonce = randomBytes(24).toString('base64')
    const html = renderWebsiteReceptionistHtml(data, nonce)
    const response = new Response(html, { headers: embedHeaders })
    response.headers.delete('X-Frame-Options')
    response.headers.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors ${data.allowedOrigins.map(value => websiteOriginSchema.parse(value)).join(' ')}; base-uri 'none'; object-src 'none'; form-action 'none'`)
    return response
  } catch (error) {
    return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>Assistant unavailable</title><p>The business assistant is unavailable. Contact the business directly.</p></html>', { status: status(error), headers: { ...embedHeaders, 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } })
  }
}
