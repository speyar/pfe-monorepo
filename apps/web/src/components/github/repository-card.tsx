import type { RepoData } from '@/data/repos/use-repos'
import { Globe, Lock, MessageSquare, Clock, ExternalLink, CircleCheck, Circle } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'

type Props = { repository: RepoData }

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

export default function RepositoryCard({ repository }: Props) {
  const r = repository
  const monitored = r.sentryProject?.enabled ?? false

  return (
    <Link href={`/repos/${r.id}`} className="block">
      <div className="group rounded-lg border bg-card p-4 cursor-pointer">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              {r.private ? (
                <Lock className="size-4 text-muted-foreground" />
              ) : (
                <Globe className="size-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{r.full_name}</p>
                <Badge variant="outline" className="h-5 px-1.5 py-0 text-[10px] shrink-0">
                  {r.private ? 'Private' : 'Public'}
                </Badge>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <MessageSquare className="size-3" />
                  {r.reviewCount}
                </div>
                {r.lastReviewAt && (
                  <div className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {timeAgo(r.lastReviewAt)}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {monitored ? (
                    <CircleCheck className="size-3 text-green-500" />
                  ) : (
                    <Circle className="size-3 text-muted-foreground/40" />
                  )}
                  {monitored ? 'Sentry' : 'None'}
                </div>
              </div>
            </div>
          </div>
          <span
            onClick={(e) => {
              e.stopPropagation()
              window.open(r.html_url, '_blank')
            }}
            className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          >
            <ExternalLink className="size-4" />
          </span>
        </div>
      </div>
    </Link>
  )
}
