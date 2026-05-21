import fetcher from '@/lib/fetcher'
import useSWR from 'swr'
import type { AppError } from '@/lib/error'

export type RepoData = {
  id: number
  owner: { login: string }
  name: string
  full_name: string
  html_url: string
  private: boolean
  description: null
  sentryProject: { enabled: boolean; sentryOrgSlug: string } | null
  reviewCount: number
  lastReviewAt: string | null
}

type ReposData = {
  data: RepoData[]
}

export function useRepos() {
  return useSWR<ReposData, AppError>('/api/repos', fetcher)
}
