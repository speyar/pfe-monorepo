import fetcher from '@/lib/fetcher'
import useSWR from 'swr'
import type { AppError } from '@/lib/error'

export type AlertsData = {
  alerts: {
    type: string
    severity: string
    title: string
    description: string
    repoName: string
    createdAt: string
  }[]
  totalFailed: number
  totalPending: number
  total: number
}

export function useAlerts() {
  return useSWR<AlertsData, AppError>('/api/alerts', fetcher)
}
