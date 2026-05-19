import fetcher from '@/lib/fetcher'
import useSWR from 'swr'
import type { AppError } from '@/lib/error'

export type DashboardData = {
  reposCount: number
  totalReviews: number
  failedReviews: number
  pendingReviews: number
  reviewSuccessRate: number
  reviewsThisWeek: number
  activeMonitors: number
  reposWithMonitoring: number
  reposWithoutMonitoring: number
  recentReviews: {
    id: string
    prTitle: string
    prNumber: number
    repoName: string
    status: string
    createdAt: string
  }[]
  recentActivity: {
    type: string
    message: string
    createdAt: string
  }[]
}

export function useDashboard() {
  return useSWR<DashboardData, AppError>('/api/dashboard', fetcher)
}
