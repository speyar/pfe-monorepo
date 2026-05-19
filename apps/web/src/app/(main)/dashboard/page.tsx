'use client'

import { useDashboard, type DashboardData } from '@/data/dashboard/use-dashboard'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import {
  GitBranch,
  MessageSquare,
  Bug,
  RefreshCw,
  ChevronRight,
  GitPullRequest,
  CheckCircle,
  XCircle,
  Clock,
  Activity,
  Wrench,
} from 'lucide-react'

const statusConfig: Record<
  string,
  { label: string; variant: 'default' | 'destructive' | 'secondary' }
> = {
  completed: { label: 'Pass', variant: 'default' },
  failed: { label: 'Fail', variant: 'destructive' },
  pending: { label: 'Pending', variant: 'secondary' },
}

function StatCard({
  label,
  value,
  icon: Icon,
  loading,
  sub,
  href,
}: {
  label: string
  value?: number | string
  icon: React.ElementType
  loading?: boolean
  sub?: string
  href?: string
}) {
  const router = useRouter()

  const content = (
    <Card size="sm" className={href ? 'cursor-pointer hover:bg-foreground/[0.02] transition-colors' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{label}</CardTitle>
          <Icon className="size-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <>
            <p className="text-2xl font-bold tracking-tight">{value ?? 0}</p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )

  if (href) {
    return <div onClick={() => router.push(href)}>{content}</div>
  }

  return content
}

function RecentReviews({
  reviews,
  loading,
}: {
  reviews?: DashboardData['recentReviews']
  loading?: boolean
}) {
  const router = useRouter()

  if (loading) {
    return (
      <div className="divide-y">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    )
  }

  if (!reviews || reviews.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <MessageSquare className="size-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No reviews yet</p>
        <p className="text-xs text-muted-foreground/60">
          Reviews will appear once PRs are reviewed
        </p>
      </div>
    )
  }

  return (
    <div className="divide-y">
      {reviews.map((r, i) => {
        const cfg = statusConfig[r.status] ?? statusConfig.pending
        return (
          <div
            key={`${r.repoName}-${r.prNumber}-${i}`}
            onClick={() => router.push(`/pulls/${r.id}`)}
            className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-foreground/[0.02] transition-colors"
          >
            <Badge
              variant={cfg.variant}
              className="w-14 shrink-0 justify-center text-[10px] capitalize"
            >
              {cfg.label}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.prTitle}</p>
              <p className="text-xs text-muted-foreground">
                {r.repoName} #{r.prNumber}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
          </div>
        )
      })}
    </div>
  )
}

function ActivityFeed({
  activities,
  loading,
}: {
  activities?: DashboardData['recentActivity']
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="divide-y">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="mt-0.5 size-4 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <Activity className="size-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No recent activity</p>
      </div>
    )
  }

  const typeConfig: Record<string, { icon: React.ElementType; color: string }> = {
    review: { icon: GitPullRequest, color: 'text-primary' },
    repo: { icon: GitBranch, color: 'text-muted-foreground' },
    monitor: { icon: Bug, color: 'text-orange-500' },
    fix: { icon: Wrench, color: 'text-green-500' },
  }

  return (
    <div className="divide-y">
      {activities.map((a, i) => {
        const cfg = typeConfig[a.type] ?? { icon: Activity, color: 'text-muted-foreground' }
        const Icon = cfg.icon
        return (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <Icon className={`mt-0.5 size-4 shrink-0 ${cfg.color}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">{a.message}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" />
                {timeAgo(a.createdAt)}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
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

export default function DashboardPage() {
  const { data, error, isLoading, mutate } = useDashboard()

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Dashboard</h2>
          <p className="text-sm text-muted-foreground">Overview of your workspace</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => mutate()} disabled={isLoading}>
          <RefreshCw className={`size-3 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <XCircle className="size-8 text-destructive/50" />
            <p className="text-sm font-medium text-destructive">Failed to load dashboard</p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => mutate()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Repositories"
              value={data?.reposCount}
              icon={GitBranch}
              loading={isLoading}
              sub="Connected to Falcon"
              href="/repos"
            />
            <StatCard
              label="Total Reviews"
              value={data?.totalReviews}
              icon={MessageSquare}
              loading={isLoading}
              sub={`${data?.reviewsThisWeek ?? 0} this week`}
              href="/pulls"
            />
            <StatCard
              label="Success Rate"
              value={data ? `${data.reviewSuccessRate ?? 0}%` : undefined}
              icon={CheckCircle}
              loading={isLoading}
              sub={`${data?.failedReviews ?? 0} failed, ${data?.pendingReviews ?? 0} pending`}
              href="/pulls"
            />
            <StatCard
              label="Monitoring"
              value={data?.activeMonitors}
              icon={Bug}
              loading={isLoading}
              sub={`${data?.reposWithoutMonitoring ?? 0} repos not monitored`}
              href="/issues"
            />
          </div>

          {/* Two-column layout */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Recent Reviews</CardTitle>
                    <CardDescription>Last 5 pull request reviews</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => window.location.href = '/pulls'}>
                    View all
                    <ChevronRight className="size-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-0">
                <RecentReviews reviews={data?.recentReviews} loading={isLoading} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Activity</CardTitle>
                    <CardDescription>Recent events across your repos</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-0">
                <ActivityFeed activities={data?.recentActivity} loading={isLoading} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
