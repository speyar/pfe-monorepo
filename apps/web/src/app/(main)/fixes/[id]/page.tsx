'use client'

import { useParams, useRouter } from 'next/navigation'
import { useMemo } from 'react'
import useSWR from 'swr'
import fetcher from '@/lib/fetcher'
import { timeAgo } from '@/lib/time-ago'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft,
  ExternalLink,
  Wrench,
  GitBranch,
  CheckCircle2,
  XCircle,
  Clock,
  FileCode,
  AlertCircle,
} from 'lucide-react'
import type { AppError } from '@/lib/error'
import { cn } from '@/lib/utils'
import Link from 'next/link'

type ChangedFile = {
  path: string
  description: string
}

type FixDetail = {
  id: string
  repoName: string
  repoId: string | null
  issueId: string
  issueTitle: string
  status: string
  prUrl: string | null
  branchName: string | null
  summary: string | null
  rootCause: string | null
  filesChanged: ChangedFile[] | null
  error: string | null
  createdAt: string
  updatedAt: string
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary'; icon: typeof CheckCircle2 }> = {
  success: { label: 'Success', variant: 'default', icon: CheckCircle2 },
  failed: { label: 'Failed', variant: 'destructive', icon: XCircle },
  running: { label: 'Running', variant: 'secondary', icon: Clock },
}

export default function FixDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { data, error, isLoading } = useSWR<FixDetail, AppError>(
    `/api/fixes/${params.id}`,
    fetcher,
  )

  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.push('/fixes')}>
          <ArrowLeft className="size-3 mr-1" />
          Back to Fix History
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Wrench className="size-8 text-destructive/50" />
            <p className="text-sm font-medium text-destructive">Failed to load fix details</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const cfg = data ? statusConfig[data.status] ?? statusConfig.running : null
  const StatusIcon = cfg?.icon

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/fixes')}>
        <ArrowLeft className="size-3 mr-1" />
        Back to Fix History
      </Button>

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          {/* Header */}
          <Card>
            <CardContent className="px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {cfg && StatusIcon && (
                      <Badge variant={cfg.variant} className="capitalize">
                        <StatusIcon className="size-3 mr-1" />
                        {cfg.label}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{data.repoName}</span>
                    {data.branchName && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                        <GitBranch className="size-3" />
                        {data.branchName}
                      </span>
                    )}
                  </div>

                  <h2 className="text-lg font-semibold leading-snug">{data.issueTitle}</h2>

                  <p className="text-xs text-muted-foreground">
                    Created {timeAgo(data.createdAt)}
                    {data.updatedAt !== data.createdAt && (
                      <> · updated {timeAgo(data.updatedAt)}</>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {data.prUrl && (
                    <a href={data.prUrl} target="_blank" rel="noreferrer">
                      <Button variant="outline" size="sm">
                        View PR
                        <ExternalLink className="size-3 ml-1" />
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Error */}
          {data.status === 'failed' && data.error && (
            <Card>
              <CardContent className="flex items-start gap-3 px-4 py-4 border-l-4 border-l-destructive">
                <AlertCircle className="size-5 shrink-0 mt-0.5 text-destructive" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-destructive">Fix failed</p>
                  <p className="text-sm text-muted-foreground mt-1">{data.error}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Root Cause */}
            {data.rootCause && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <AlertCircle className="size-4" />
                    Root Cause
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{data.rootCause}</p>
                </CardContent>
              </Card>
            )}

            {/* Summary */}
            {data.summary && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Wrench className="size-4" />
                    Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{data.summary}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Files Changed */}
          {data.filesChanged && data.filesChanged.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileCode className="size-4" />
                  Files Changed ({data.filesChanged.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y rounded-lg border">
                  {data.filesChanged.map((file, i) => (
                    <div key={i} className="flex items-start gap-3 px-3 py-2.5">
                      <FileCode className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm font-mono font-medium truncate">{file.path}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{file.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Not found fallback */}
          {!data.rootCause && !data.summary && (!data.filesChanged || data.filesChanged.length === 0) && data.status !== 'failed' && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <CheckCircle2 className="size-8 text-green-500/50" />
                <p className="text-sm text-muted-foreground">No additional details available for this fix run.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
