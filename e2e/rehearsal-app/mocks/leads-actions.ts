'use client'
import { actionResult } from './action-result'
export const createLead = (data: FormData) =>
  actionResult('/api/mock/core/leads', data)
export const updateLead = (data: FormData) =>
  actionResult('/api/mock/core/leads', data)
