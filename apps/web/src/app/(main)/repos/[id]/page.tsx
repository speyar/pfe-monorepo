'use client'

import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import fetcher from '@/lib/fetcher'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import RepoPullsSection from '@/components/pulls/repo-pulls-section'
import {
  ArrowLeft,
  ExternalLink,
  Globe,
  Lock,
  GitBranch,
  MessageSquare,
  Bug,
  CheckCircle,
  Circle,
} from 'lucide-react'
import type { AppError } from '@/lib/error'

type RepoDetail = {
  id: string
  repoId: number
  name: string
  fullName: string
  private: boolean
  reviewCount: number
  monitoring: {
    enabled: boolean
    orgSlug: string
    projectSlug: string
    environment: string | null
  } | null
}

export default function RepoDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { data, error, isLoading } = useSWR<RepoDetail, AppError>(
    `/api/repos/${params.id}`,
    fetcher,
  )

  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.push('/repos')}>
          <ArrowLeft className="size-3 mr-1" />
          Back to Repositories
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <GitBranch className="size-8 text-destructive/50" />
            <p className="text-sm font-medium text-destructive">Failed to load repository</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/repos')}>
        <ArrowLeft className="size-3 mr-1" />
        Back to Repositories
      </Button>

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="grid gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                {data.private ? (
                  <Lock className="size-4 text-muted-foreground" />
                ) : (
                  <Globe className="size-4 text-muted-foreground" />
                )}
                <Badge variant="outline" className="text-[10px]">
                  {data.private ? 'Private' : 'Public'}
                </Badge>
                {data.monitoring?.enabled && (
                  <Badge variant="default" className="gap-1 text-[10px]">
                    <CheckCircle className="size-3" />
                    Monitored
                  </Badge>
                )}
              </div>
              <h2 className="text-lg font-semibold">{data.fullName}</h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/repos/${data.id}/monitoring`)}
              >
                <Bug className="size-3 mr-1" />
                Monitoring
              </Button>
              <a
                href={`https://github.com/${data.fullName}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="outline" size="sm">
                  <ExternalLink className="size-3 mr-1" />
                  GitHub
                </Button>
              </a>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Card size="sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Reviews</CardTitle>
                  <MessageSquare className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tracking-tight">{data.reviewCount}</p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Monitoring</CardTitle>
                  <Bug className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {data.monitoring ? (
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-green-500">Active</p>
                    <p className="text-xs text-muted-foreground">
                      {data.monitoring.orgSlug}/{data.monitoring.projectSlug}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-muted-foreground">Not configured</p>
                )}
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Sentry</CardTitle>
                  {data.monitoring?.enabled ? (
                    <CheckCircle className="size-4 text-green-500" />
                  ) : (
                    <Circle className="size-4 text-muted-foreground/40" />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium">
                  {data.monitoring?.enabled ? 'Connected' : 'Not connected'}
                </p>
              </CardContent>
            </Card>
          </div>

          <RepoPullsSection repoId={params.id} />
        </>
      )}
    </div>
  )
}
