'use client'
import { actionResult } from './action-result'
export const submitForecast = (data: FormData) => actionResult('/api/mock/forecast', data)
