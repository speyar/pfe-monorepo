import type { RepoData } from '@/data/repos/use-repos'
import { Globe, Lock, MessageSquare, CircleCheck, Circle, ExternalLink } from 'lucide-react'
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

export default function RepositoryRow({ repository }: Props) {
  const r = repository
  const monitored = r.sentryProject?.enabled ?? false

  return (
    <Link
      href={`/repos/${r.id}`}
      className="group grid grid-cols-[1fr_80px_60px_100px_32px] items-center gap-4 border-b px-4 py-3 text-sm transition-colors hover:bg-muted/30 cursor-pointer last:border-0"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          {r.private ? (
            <Lock className="size-3.5 text-muted-foreground" />
          ) : (
            <Globe className="size-3.5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{r.full_name}</p>
        </div>
        <Badge variant="outline" className="h-5 px-1.5 py-0 text-[10px] shrink-0">
          {r.private ? 'Private' : 'Public'}
        </Badge>
      </div>

      <div className="flex items-center gap-1.5 text-muted-foreground">
        <MessageSquare className="size-3.5" />
        {r.reviewCount}
      </div>

      <div className="text-muted-foreground">{r.lastReviewAt ? timeAgo(r.lastReviewAt) : '—'}</div>

      <div className="flex items-center gap-1.5">
        {monitored ? (
          <>
            <CircleCheck className="size-3.5 text-green-500" />
            <span className="text-green-500">Sentry</span>
          </>
        ) : (
          <>
            <Circle className="size-3.5 text-muted-foreground/40" />
            <span className="text-muted-foreground">None</span>
          </>
        )}
      </div>

      <span
        onClick={(e) => {
          e.stopPropagation()
          window.open(r.html_url, '_blank')
        }}
        className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      >
        <ExternalLink className="size-4" />
      </span>
    </Link>
  )
}
