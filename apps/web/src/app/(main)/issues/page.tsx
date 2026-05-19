'use client'

import { useMonitoring, type MonitoringData } from '@/data/monitoring/use-monitoring'
import { useAlerts, type AlertsData } from '@/data/alerts/use-alerts'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { timeAgo } from '@/lib/time-ago'
import { Bug, CheckCircle, XCircle, AlertTriangle, Bell, AlertCircle } from 'lucide-react'
import Link from 'next/link'

const sevCfg: Record<string, 'destructive' | 'secondary'> = {
  error: 'destructive',
  warning: 'secondary',
}

function MonitoringOverview({ data, loading }: { data?: MonitoringData; loading?: boolean }) {
  if (loading) {
    return (
      <div className="divide-y">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  if (!data?.repos.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <Bug className="size-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No repositories connected</p>
      </div>
    )
  }

  return (
    <div className="divide-y">
      {data.repos.map((r) => (
        <Link
          key={r.id}
          href={`/repos/${r.id}`}
          className="flex items-center gap-3 px-4 py-3 hover:bg-foreground/[0.02] transition-colors cursor-pointer"
        >
          {r.monitored && r.enabled ? (
            <CheckCircle className="size-4 shrink-0 text-green-500" />
          ) : (
            <XCircle className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm">{r.fullName}</span>
          <div className="flex items-center gap-2 shrink-0">
            {r.orgSlug && r.projectSlug && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {r.orgSlug}/{r.projectSlug}
              </span>
            )}
            <Badge
              variant={r.monitored && r.enabled ? 'default' : 'secondary'}
              className="shrink-0"
            >
              {r.monitored && r.enabled ? 'Monitored' : 'Not monitored'}
            </Badge>
          </div>
        </Link>
      ))}
    </div>
  )
}

function AlertsList({ data, loading }: { data?: AlertsData; loading?: boolean }) {
  if (loading) {
    return (
      <div className="divide-y">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="mt-0.5 size-4 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!data?.alerts.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <Bell className="size-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No alerts</p>
        <p className="text-xs text-muted-foreground/60">Everything looks good</p>
      </div>
    )
  }

  return (
    <div className="divide-y">
      {data.alerts.map((a, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <AlertTriangle
            className={`mt-0.5 size-4 shrink-0 ${a.severity === 'error' ? 'text-destructive' : 'text-orange-500'}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{a.title}</p>
            <p className="text-xs text-muted-foreground">{a.description}</p>
            {a.repoName && <p className="text-xs text-muted-foreground/60">{a.repoName}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</p>
          </div>
          <Badge
            variant={sevCfg[a.severity] ?? 'secondary'}
            className="shrink-0 text-[10px] capitalize"
          >
            {a.severity}
          </Badge>
        </div>
      ))}
    </div>
  )
}

export default function IssuesPage() {
  const { data: monitoring, error: monitoringError, isLoading: loadingMonitoring } = useMonitoring()
  const { data: alerts, error: alertsError, isLoading: loadingAlerts } = useAlerts()

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Issues & Alerts</h2>
        <p className="text-sm text-muted-foreground">Monitoring status and system alerts</p>
      </div>

      {monitoringError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <AlertCircle className="size-8 text-destructive/50" />
            <p className="text-sm font-medium text-destructive">Failed to load monitoring data</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card size="sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Total Repos</CardTitle>
                  <Bug className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {loadingMonitoring ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <p className="text-2xl font-bold">{monitoring?.totalRepos ?? 0}</p>
                )}
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Monitored</CardTitle>
                  <CheckCircle className="size-4 text-green-500" />
                </div>
              </CardHeader>
              <CardContent>
                {loadingMonitoring ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <p className="text-2xl font-bold text-green-500">
                    {monitoring?.monitoredCount ?? 0}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Alerts</CardTitle>
                  <AlertTriangle className="size-4 text-orange-500" />
                </div>
              </CardHeader>
              <CardContent>
                {loadingAlerts ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <p className="text-2xl font-bold text-orange-500">{alerts?.total ?? 0}</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Repository Monitoring</CardTitle>
                <CardDescription>
                  {loadingMonitoring
                    ? 'Loading...'
                    : `${monitoring?.monitoredCount ?? 0} of ${monitoring?.totalRepos ?? 0} repos monitored`}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <MonitoringOverview data={monitoring} loading={loadingMonitoring} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Alerts</CardTitle>
                    <CardDescription>
                      {loadingAlerts
                        ? 'Loading...'
                        : `${alerts?.total ?? 0} alert${(alerts?.total ?? 0) !== 1 ? 's' : ''}`}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-0">
                <AlertsList data={alerts} loading={loadingAlerts} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
