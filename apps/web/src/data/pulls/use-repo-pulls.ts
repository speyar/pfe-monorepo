import fetcher from '@/lib/fetcher'
import useSWR from 'swr'
import type { AppError } from '@/lib/error'
import type { PullItem } from './use-pulls'

export type RepoPullsData = {
  data: PullItem[]
  total: number
  totalPages: number
  page: number
  limit: number
}

type RepoPullsParams = {
  search?: string
  status?: string
  sort?: 'newest' | 'oldest'
  page?: number
  limit?: number
}

function buildQuery(repoId: string, params: RepoPullsParams): string {
  const sp = new URLSearchParams()
  if (params.search) sp.set('search', params.search)
  if (params.status) sp.set('status', params.status)
  if (params.sort && params.sort !== 'newest') sp.set('sort', params.sort)
  if (params.page && params.page > 1) sp.set('page', String(params.page))
  if (params.limit && params.limit !== 10) sp.set('limit', String(params.limit))
  const qs = sp.toString()
  return `/api/repos/${repoId}/pulls${qs ? `?${qs}` : ''}`
}

export function useRepoPulls(repoId: string, params: RepoPullsParams = {}) {
  const key = buildQuery(repoId, params)
  return useSWR<RepoPullsData, AppError>(key, fetcher)
}
