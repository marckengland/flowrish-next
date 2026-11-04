'use client'
import { actionResult } from './action-result'
export const createTask = (data: FormData) =>
  actionResult('/api/mock/core/tasks', data)
export const updateTask = (data: FormData) =>
  actionResult('/api/mock/core/tasks', data)
