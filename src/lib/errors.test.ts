import { describe, it, expect, vi } from 'vitest'
import { AppError, errorResponse } from './errors'
import { ZodError, z } from 'zod'

describe('AppError', () => {
  it('creates an error with code, message, and statusCode', () => {
    const error = new AppError('NOT_FOUND', 'Lead not found', 404)

    expect(error.code).toBe('NOT_FOUND')
    expect(error.message).toBe('Lead not found')
    expect(error.statusCode).toBe(404)
    expect(error.name).toBe('AppError')
    expect(error).toBeInstanceOf(Error)
  })

  it('defaults statusCode to 500', () => {
    const error = new AppError('INTERNAL_ERROR', 'Something went wrong')

    expect(error.statusCode).toBe(500)
  })
})

describe('errorResponse', () => {
  it('handles AppError with custom status code', async () => {
    const error = new AppError('FORBIDDEN', 'Insufficient permissions', 403)
    const response = errorResponse(error)

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body).toEqual({
      error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
    })
  })

  it('handles ZodError with 400 status', async () => {
    const schema = z.object({ name: z.string().min(1, 'Name is required') })
    let zodError: ZodError | undefined
    try {
      schema.parse({ name: '' })
    } catch (e) {
      zodError = e as ZodError
    }

    const response = errorResponse(zodError!)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
    })
  })

  it('handles unknown errors with 500 and generic message', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('database connection failed: password=secret123')
    const response = errorResponse(error)

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    })
    // Verify internals are NOT exposed in the response
    const bodyStr = JSON.stringify(body)
    expect(bodyStr).not.toContain('database connection failed')
    expect(bodyStr).not.toContain('secret123')

    consoleSpy.mockRestore()
  })

  it('handles non-Error unknown values with 500', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = errorResponse('some string error')

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    })

    consoleSpy.mockRestore()
  })

  it('handles null/undefined with 500', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = errorResponse(null)

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    })

    consoleSpy.mockRestore()
  })

  it('always returns consistent error shape', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const cases = [
      new AppError('NOT_FOUND', 'Not found', 404),
      new ZodError([{ code: 'custom', message: 'Invalid', path: ['field'] }]),
      new Error('unexpected'),
      null,
      undefined,
      42,
    ]

    for (const error of cases) {
      const response = errorResponse(error)
      const body = await response.json()
      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('code')
      expect(body.error).toHaveProperty('message')
      expect(typeof body.error.code).toBe('string')
      expect(typeof body.error.message).toBe('string')
    }

    consoleSpy.mockRestore()
  })
})
