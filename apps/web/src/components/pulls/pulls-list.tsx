'use client'

import { useState, useEffect } from 'react'
import useSWRInfinite from 'swr/infinite'
import fetcher from '@/lib/fetcher'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { timeAgo } from '@/lib/time-ago'
import {
  GitPullRequest,
  GitBranch,
  ExternalLink,
  Search,
  X,
  ArrowRight,
  ChevronDown,
  Loader2,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import EmptyState from '@/components/shared/empty-state'
import ErrorCard from '@/components/error/error-card'
import type { PullItem, PullsData } from '@/data/pulls/use-pulls'

const statusConfig: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' }> = {
  completed: { label: 'Pass', variant: 'default' },
  failed: { label: 'Fail', variant: 'destructive' },
  pending: { label: 'Pending', variant: 'secondary' },
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'completed', label: 'Pass' },
  { value: 'failed', label: 'Fail' },
  { value: 'pending', label: 'Pending' },
] as const

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
] as const

function PrStateBadge({ prState, prMerged, prDraft }: { prState: string | null; prMerged: boolean; prDraft: boolean }) {
  if (prDraft) return <Badge variant="secondary" className="text-[10px]">Draft</Badge>
  if (prState === 'closed' && prMerged) return <Badge variant="outline" className="text-[10px] text-purple-600 border-purple-300 dark:text-purple-400 dark:border-purple-700">Merged</Badge>
  if (prState === 'closed') return <Badge variant="destructive" className="text-[10px]">Closed</Badge>
  if (prState === 'open') return <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 dark:text-green-400 dark:border-green-700">Open</Badge>
  return null
}

function PullRow({ pr }: { pr: PullItem }) {
  const router = useRouter()

  return (
    <div
      onClick={() => router.push(`/pulls/${pr.id}`)}
      className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-foreground/[0.02] transition-colors"
    >
      <Badge
        variant={statusConfig[pr.status]?.variant ?? 'secondary'}
        className="w-14 shrink-0 justify-center text-[10px] capitalize"
      >
        {statusConfig[pr.status]?.label ?? pr.status}
      </Badge>
      <PrStateBadge prState={pr.prState} prMerged={pr.prMerged} prDraft={pr.prDraft} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{pr.prTitle}</p>
          <a
            href={pr.prUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3" />
          </a>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{pr.repoName} #{pr.prNumber}</span>
          {pr.prAuthor && (
            <>
              <span aria-hidden="true">·</span>
              <span>@{pr.prAuthor}</span>
            </>
          )}
          {pr.headRef && pr.baseRef && (
            <>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1 font-mono">
                <GitBranch className="size-3" />
                {pr.headRef}
                <ArrowRight className="size-3" />
                {pr.baseRef}
              </span>
            </>
          )}
        </div>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {timeAgo(pr.createdAt)}
      </span>
    </div>
  )
}

export default function PullsList() {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const getKey = (pageIndex: number, previousPageData: PullsData | null) => {
    if (previousPageData && !previousPageData.data.length) return null
    const params = new URLSearchParams({ page: String(pageIndex + 1), limit: '10' })
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (sort !== 'newest') params.set('sort', sort)
    return `/api/pulls?${params.toString()}`
  }

  const { data, size, setSize, isValidating, isLoading, error } = useSWRInfinite<PullsData>(getKey, fetcher, {
    revalidateFirstPage: false,
  })

  const allItems = data ? data.flatMap((d) => d.data) : []
  const total = data?.[0]?.total ?? 0
  const totalPages = data?.[0]?.totalPages ?? 0
  const hasMore = size < totalPages

  const handleSearchInput = (value: string) => {
    setSearchInput(value)
  }

  const handleStatusChange = (value: string | null) => {
    setStatus(value ?? '')
  }

  const handleSortChange = (value: string | null) => {
    setSort((value ?? 'newest') as 'newest' | 'oldest')
  }

  if (error) {
    return <ErrorCard title="Unable to load pull requests" />
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-md border bg-background px-3 text-sm h-9">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            placeholder="Search pull requests..."
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="w-full bg-transparent py-2 text-foreground placeholder-muted-foreground outline-none"
          />
          {searchInput && (
            <button
              onClick={() => handleSearchInput('')}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <Select value={sort} onValueChange={handleSortChange}>
          <SelectTrigger className="w-[160px] !h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-[160px] !h-9">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="divide-y rounded-lg border">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      ) : allItems.length === 0 ? (
        <EmptyState
          icon={GitPullRequest}
          title={search || status ? 'No results' : 'No pull requests reviewed yet'}
          description={
            search || status
              ? 'Try adjusting your search or filters.'
              : 'Pull requests reviewed by the AI agent will appear here.'
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {allItems.length} of {total} pull request{total !== 1 ? 's' : ''}
          </p>
          <div className="divide-y rounded-lg border">
            {allItems.map((pr, i) => (
              <PullRow key={`${pr.repoName}/${pr.prNumber}-${i}`} pr={pr} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSize(size + 1)}
                disabled={isValidating}
                className="gap-1 text-muted-foreground"
              >
                {isValidating ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
                View more
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
