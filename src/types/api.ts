/**
 * Shared API request/response type definitions.
 *
 * All API responses follow a consistent structure for both
 * success and error cases.
 */

/**
 * Standard error response body returned by all API endpoints.
 */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

/**
 * Standard success response wrapper for single-item responses.
 */
export interface ApiSuccessResponse<T> {
  data: T
}

/**
 * Standard paginated list response.
 */
export interface ApiPaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

/**
 * Pagination query parameters accepted by list endpoints.
 */
export interface PaginationParams {
  page?: number
  pageSize?: number
}

/**
 * Sort direction for list endpoints.
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Common sort parameters.
 */
export interface SortParams {
  sortBy?: string
  sortDirection?: SortDirection
}

/**
 * Combined list query parameters (pagination + sorting).
 */
export interface ListParams extends PaginationParams, SortParams {}

/**
 * Standard HTTP error codes used across the application.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
