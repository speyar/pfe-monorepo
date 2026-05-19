import fetcher from '@/lib/fetcher'
import useSWR from 'swr'
import type { AppError } from '@/lib/error'

export type MonitoringData = {
  repos: {
    id: string
    fullName: string
    name: string
    repoId: number
    monitored: boolean
    orgSlug: string | null
    projectSlug: string | null
    enabled: boolean
  }[]
  totalRepos: number
  monitoredCount: number
  unmonitoredCount: number
  sentryConnected: boolean
  recentLinks: {
    repoName: string
    orgSlug: string
    projectSlug: string
    enabled: boolean
    createdAt: string
  }[]
}

export function useMonitoring() {
  return useSWR<MonitoringData, AppError>('/api/monitoring', fetcher)
}
