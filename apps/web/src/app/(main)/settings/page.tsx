'use client'

import { UserProfile } from '@clerk/nextjs'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Github, Bug, CheckCircle, XCircle, ExternalLink } from 'lucide-react'
import useSWR from 'swr'
import fetcher from '@/lib/fetcher'
import { useState } from 'react'

type ReposResponse = { data: unknown[] }
type SentryStatusResponse = { connected: boolean }

function IntegrationCardSkeleton() {
  return <div className="h-5 w-20 animate-pulse rounded-full bg-foreground/10" />
}

export default function SettingsPage() {
  const [isConnectingSentry, setIsConnectingSentry] = useState(false)
  const [sentryConnectError, setSentryConnectError] = useState<string | null>(null)

  const { data: reposData, isLoading: reposLoading } = useSWR<ReposResponse>('/api/repos', fetcher)
  const { data: sentryData, isLoading: sentryLoading } = useSWR<SentryStatusResponse>(
    '/api/integrations/sentry/status',
    fetcher,
  )
  const githubConnected = (reposData?.data?.length ?? 0) > 0
  const sentryConnected = sentryData?.connected ?? false

  async function handleConnectSentry() {
    setSentryConnectError(null)
    setIsConnectingSentry(true)

    try {
      const response = await fetch('/api/integrations/sentry/connect')
      const payload = (await response.json()) as {
        url?: string
        error?: string
      }

      if (!response.ok || !payload.url) {
        setSentryConnectError(payload.error ?? 'Failed to start Sentry OAuth flow')
        return
      }

      window.location.href = payload.url
    } catch {
      setSentryConnectError('Failed to start Sentry OAuth flow')
    } finally {
      setIsConnectingSentry(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your account and connections</p>
      </div>

      <UserProfile />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Integrations</CardTitle>
            <CardDescription>Connected services and permissions</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Github className="size-5" />
              <div>
                <p className="text-sm font-medium">GitHub</p>
                <p className="text-xs text-muted-foreground">PR review and repository access</p>
              </div>
            </div>
            {reposLoading ? (
              <IntegrationCardSkeleton />
            ) : githubConnected ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle className="size-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <XCircle className="size-3" />
                Not connected
              </Badge>
            )}
          </div>
          {!githubConnected && !reposLoading && (
            <div className="px-1">
              <p className="text-xs text-muted-foreground mb-2">
                GitHub App not installed. Install to enable AI code reviews.
              </p>
              <a
                href={process.env.NEXT_PUBLIC_APP_INSTALLATION_URL || '#'}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="default" size="sm">
                  Install GitHub App
                  <ExternalLink className="size-3 ml-1" />
                </Button>
              </a>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Bug className="size-5" />
              <div>
                <p className="text-sm font-medium">Sentry</p>
                <p className="text-xs text-muted-foreground">Error monitoring and auto-fix</p>
              </div>
            </div>
            {sentryLoading ? (
              <IntegrationCardSkeleton />
            ) : sentryConnected ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle className="size-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <XCircle className="size-3" />
                Not connected
              </Badge>
            )}
          </div>
          {!sentryConnected && !sentryLoading && (
            <div className="px-1">
              <p className="text-xs text-muted-foreground mb-2">
                Connect Sentry to enable error monitoring and auto-fix for your repositories.
              </p>
              <Button
                variant="default"
                size="sm"
                onClick={handleConnectSentry}
                disabled={isConnectingSentry}
              >
                {isConnectingSentry ? 'Connecting...' : 'Connect Sentry'}
                <ExternalLink className="size-3 ml-1" />
              </Button>
              {sentryConnectError ? (
                <p className="text-xs text-destructive mt-2">{sentryConnectError}</p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
