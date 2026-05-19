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
  page: number
  totalPages: number
  total: number
}

export function useRepos(page: number = 1, limit: number = 50) {
  const params = new URLSearchParams()
  params.append('page', page.toString())
  params.append('limit', limit.toString())

  const url = `/api/repos?${params.toString()}`

  return useSWR<ReposData, AppError>(url, fetcher, {
    keepPreviousData: true,
  })
}
