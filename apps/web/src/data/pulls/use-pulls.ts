import fetcher from '@/lib/fetcher'
import useSWR from 'swr'
import type { AppError } from '@/lib/error'

export type PullsData = {
  data: {
    id: string
    repoName: string
    repo: string
    prNumber: number
    prTitle: string
    prUrl: string
    status: string
    createdAt: string
  }[]
  total: number
}

export function usePulls() {
  return useSWR<PullsData, AppError>('/api/pulls', fetcher)
}
