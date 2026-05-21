'use client'

import { useState } from 'react'
import { useRepoPulls } from '@/data/pulls/use-repo-pulls'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { useRouter } from 'next/navigation'
import { timeAgo } from '@/lib/time-ago'
import {
  GitPullRequest,
  GitBranch,
  ExternalLink,
  Search,
  X,
  ArrowRight,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import NumberedPagination from '@/components/filters/numbered-pagination'
import type { PullItem } from '@/data/pulls/use-pulls'

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
          <span>#{pr.prNumber}</span>
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

type RepoPullsSectionProps = {
  repoId: string
}

export default function RepoPullsSection({ repoId }: RepoPullsSectionProps) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [page, setPage] = useState(1)

  const { data, isLoading, error } = useRepoPulls(repoId, { search, status, sort, page, limit: 10 })

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const handleStatusChange = (value: string | null) => {
    setStatus(value ?? '')
    setPage(1)
  }

  const handleSortChange = (value: string | null) => {
    setSort((value ?? 'newest') as 'newest' | 'oldest')
    setPage(1)
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm text-destructive">Failed to load pull requests</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pull Requests</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <div className="flex items-center gap-2 px-4 pb-3">
          <div className="flex flex-1 items-center gap-2 rounded-md border bg-background px-3 text-sm h-9">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              placeholder="Search pull requests..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full bg-transparent py-2 text-foreground placeholder-muted-foreground outline-none"
            />
            {search && (
              <button
                onClick={() => handleSearchChange('')}
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
          <div className="divide-y">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-12 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        ) : !data || data.data.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <GitPullRequest className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {search || status ? 'No pull requests match your filters.' : 'No pull requests reviewed yet.'}
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground px-4 pb-2">
              Showing {data.data.length} of {data.total} pull request{data.total !== 1 ? 's' : ''}
            </p>
            <div className="divide-y">
              {data.data.map((pr) => (
                <PullRow key={pr.id} pr={pr} />
              ))}
            </div>
            {data.totalPages > 1 && (
              <NumberedPagination page={page} setPage={setPage} totalPages={data.totalPages} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
