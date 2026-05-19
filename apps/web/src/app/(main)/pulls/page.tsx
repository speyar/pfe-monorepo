'use client'

import { usePulls } from '@/data/pulls/use-pulls'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useRouter } from 'next/navigation'
import { GitPullRequest, XCircle, ExternalLink } from 'lucide-react'

const statusConfig: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' }> = {
  completed: { label: 'Pass', variant: 'default' },
  failed: { label: 'Fail', variant: 'destructive' },
  pending: { label: 'Pending', variant: 'secondary' },
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function PullsPage() {
  const { data, error, isLoading } = usePulls()
  const router = useRouter()

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <XCircle className="size-8 text-destructive/50" />
          <p className="text-sm font-medium text-destructive">Failed to load pull requests</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Pull Requests</CardTitle>
          <CardDescription>
            {isLoading
              ? 'Loading...'
              : `${data?.total ?? 0} PR${(data?.total ?? 0) !== 1 ? 's' : ''} reviewed`}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {isLoading ? (
          <div className="divide-y">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        ) : !data?.data.length ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <GitPullRequest className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No pull requests reviewed yet</p>
          </div>
        ) : (
          <div className="divide-y">
            {data.data.map((pr) => (
              <div
                key={`${pr.repoName}/${pr.prNumber}`}
                onClick={() => router.push(`/pulls/${pr.id}`)}
                className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-foreground/[0.02] transition-colors"
              >
                <Badge
                  variant={statusConfig[pr.status]?.variant ?? 'secondary'}
                  className="w-14 shrink-0 justify-center text-[10px] capitalize"
                >
                  {statusConfig[pr.status]?.label ?? pr.status}
                </Badge>
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
                  <p className="text-xs text-muted-foreground">
                    {pr.repoName} #{pr.prNumber}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeAgo(pr.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
