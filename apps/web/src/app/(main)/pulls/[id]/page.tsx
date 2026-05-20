'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useMemo } from 'react'
import useSWR from 'swr'
import fetcher from '@/lib/fetcher'
import { timeAgo } from '@/lib/time-ago'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  ArrowLeft,
  ExternalLink,
  GitPullRequest,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Code2,
} from 'lucide-react'
import type { AppError } from '@/lib/error'
import { cn } from '@/lib/utils'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'

import 'highlight.js/styles/github-dark.css'

const statusConfig: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' }> = {
  completed: { label: 'Pass', variant: 'default' },
  failed: { label: 'Fail', variant: 'destructive' },
  pending: { label: 'Pending', variant: 'secondary' },
}

const severityConfig: Record<string, { label: string; color: string; border: string; icon: typeof AlertTriangle }> = {
  critical: { label: 'Critical', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', border: 'border-l-red-500', icon: AlertTriangle },
  high: { label: 'High', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400', border: 'border-l-orange-500', icon: AlertTriangle },
  medium: { label: 'Medium', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', border: 'border-l-yellow-500', icon: AlertTriangle },
  low: { label: 'Low', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400', border: 'border-l-gray-400', icon: AlertTriangle },
  info: { label: 'Info', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', border: 'border-l-blue-500', icon: AlertTriangle },
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value
      }
      return hljs.highlightAuto(code).value
    },
  }),
  { gfm: true, breaks: true },
)

type FindingDetail = {
  id: string
  severity: string
  file: string
  line: number | null
  quote: string | null
  title: string
  message: string
  suggestion: string | null
  postedToGitHub: boolean
  skipReason: string | null
}

type ReviewDetail = {
  id: string
  repoName: string
  repo: string
  prNumber: number
  prTitle: string
  prUrl: string
  status: string
  review: string
  findings: FindingDetail[]
  createdAt: string
  updatedAt: string
}

function MarkdownRenderer({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => {
    try {
      return marked.parse(content) as string
    } catch {
      return `<p>${content}</p>`
    }
  }, [content])

  return (
    <div
      ref={ref}
      className="prose prose-sm max-w-none text-sm leading-relaxed [&_pre]:rounded-lg [&_pre]:bg-[#0d1117] [&_pre]:p-3 [&_pre]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-normal [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:text-xs [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_input[type=checkbox]]:mr-1.5 [&_hr]:border-border"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function CodePreview({ code, language }: { code: string; language?: string }) {
  const html = useMemo(() => {
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language }).value
      }
      return hljs.highlightAuto(code).value
    } catch {
      return code
    }
  }, [code, language])

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        <Code2 className="size-3" />
        {language || 'code'}
      </div>
      <pre className="overflow-x-auto bg-[#0d1117] p-3 text-xs text-[#e6edf3]">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
}

function SeverityBadge({ severity, size = 'sm' }: { severity: string; size?: 'sm' | 'md' }) {
  const cfg = severityConfig[severity] ?? severityConfig.info
  return (
    <span className={cn('inline-flex items-center rounded-full font-medium', size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm', cfg.color)}>
      {cfg.label}
    </span>
  )
}

function SuggestionBlock({ code }: { code: string }) {
  const langMatch = code.match(/^(\w+)\n/)
  const language = langMatch?.[1]
  const cleanCode = langMatch ? code.slice(langMatch[0].length) : code

  return <CodePreview code={cleanCode} language={language} />
}

function QuoteBlock({ quote }: { quote: string }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        <FileCode className="size-3" />
        Quoted code
      </div>
      <pre className="overflow-x-auto bg-[#0d1117] p-3 text-xs text-[#e6edf3]">
        <code>{quote}</code>
      </pre>
    </div>
  )
}

function FindingCard({ finding }: { finding: FindingDetail }) {
  const cfg = severityConfig[finding.severity] ?? severityConfig.info
  const Icon = cfg.icon

  return (
    <div className={cn('rounded-lg border border-l-4 bg-card shadow-sm py-3 pl-3 pr-4', cfg.border)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <SeverityBadge severity={finding.severity} />
          {finding.file && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground truncate max-w-full">
              <FileCode className="size-3 shrink-0" />
              <span className="truncate">{finding.file}</span>
              {typeof finding.line === 'number' && <span>:{finding.line}</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {finding.postedToGitHub ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <CheckCircle2 className="size-3" />
              Posted
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" title={finding.skipReason ?? undefined}>
              <AlertTriangle className="size-3" />
              Not posted
            </span>
          )}
        </div>
      </div>
      {finding.title && (
        <p className="mt-2 text-sm font-medium">{finding.title}</p>
      )}
      <div className="mt-1 text-sm text-muted-foreground">
        <MarkdownRenderer content={finding.message} />
      </div>
      {finding.quote && <div className="mt-2"><QuoteBlock quote={finding.quote} /></div>}
      {finding.suggestion && <div className="mt-2"><SuggestionBlock code={finding.suggestion} /></div>}
      {!finding.postedToGitHub && finding.skipReason && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Not posted to GitHub — {finding.skipReason.replace(/_/g, ' ')}
        </p>
      )}
    </div>
  )
}

function FindingsSummaryBar({ findings }: { findings: FindingDetail[] }) {
  const counts: Record<string, number> = {}
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {SEVERITY_ORDER.map((sev) => {
        const count = counts[sev] ?? 0
        const cfg = severityConfig[sev]
        return (
          <div
            key={sev}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
              cfg.color,
              count === 0 && 'opacity-30',
            )}
          >
            <cfg.icon className="size-3" />
            <span>{cfg.label}</span>
            <span className="font-bold">{count}</span>
          </div>
        )
      })}
      <Separator orientation="vertical" className="h-5 mx-1" />
      <span className="text-xs text-muted-foreground">
        {findings.length} total
      </span>
    </div>
  )
}

function FindingsBySeverity({ findings }: { findings: FindingDetail[] }) {
  const grouped: Record<string, FindingDetail[]> = {}
  for (const f of findings) {
    const sev = f.severity
    if (!grouped[sev]) grouped[sev] = []
    grouped[sev].push(f)
  }

  return (
    <div className="space-y-4">
      {SEVERITY_ORDER.map((sev) => {
        const items = grouped[sev]
        if (!items?.length) return null
        const cfg = severityConfig[sev]
        return (
          <div key={sev}>
            <div className={cn('flex items-center gap-2 mb-2 px-1', cfg.color.split(' ')[0])}>
              <cfg.icon className="size-4" />
              <span className="text-sm font-semibold">{cfg.label}</span>
              <span className="text-xs text-muted-foreground">({items.length})</span>
            </div>
            <div className="space-y-4">
              {items.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FindingsByFile({ findings }: { findings: FindingDetail[] }) {
  const grouped: Record<string, FindingDetail[]> = {}
  for (const f of findings) {
    const path = f.file || 'unknown'
    if (!grouped[path]) grouped[path] = []
    grouped[path].push(f)
  }

  const sortedFiles = Object.keys(grouped).sort()

  return (
    <div className="space-y-4">
      {sortedFiles.map((file) => {
        const items = grouped[file]
        return (
          <div key={file}>
            <div className="flex items-center gap-2 mb-2 px-1">
              <FileCode className="size-4 text-muted-foreground" />
              <span className="text-sm font-mono font-medium truncate">{file}</span>
              <span className="text-xs text-muted-foreground">({items.length})</span>
            </div>
            <div className="space-y-2">
              {items.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function PullDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { data, error, isLoading } = useSWR<ReviewDetail, AppError>(
    `/api/pulls/${params.id}`,
    fetcher,
  )

  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.push('/pulls')}>
          <ArrowLeft className="size-3 mr-1" />
          Back to Pull Requests
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <GitPullRequest className="size-8 text-destructive/50" />
            <p className="text-sm font-medium text-destructive">Failed to load review</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/pulls')}>
        <ArrowLeft className="size-3 mr-1" />
        Back to Pull Requests
      </Button>

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <>
          {/* PR Header */}
          <Card>
            <CardContent className="px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={statusConfig[data.status]?.variant ?? 'secondary'}
                      className="capitalize"
                    >
                      {statusConfig[data.status]?.label ?? data.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {data.repoName} #{data.prNumber}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold leading-snug">{data.prTitle}</h2>
                  <p className="text-xs text-muted-foreground">
                    Reviewed {timeAgo(data.createdAt)}
                  </p>
                </div>
                <a href={data.prUrl} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm">
                    View on GitHub
                    <ExternalLink className="size-3 ml-1" />
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>

          {/* Findings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4" />
                Review Findings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.findings && data.findings.length > 0 ? (
                <>
                  <FindingsSummaryBar findings={data.findings} />
                  <Separator />
                  <Tabs defaultValue="severity">
                    <TabsList>
                      <TabsTrigger value="all">
                        All <span className="text-xs text-muted-foreground">({data.findings.length})</span>
                      </TabsTrigger>
                      <TabsTrigger value="severity">
                        By Severity
                      </TabsTrigger>
                      <TabsTrigger value="file">
                        By File
                      </TabsTrigger>
                    </TabsList>
                    <Separator className="my-3" />
                    <TabsContent value="all">
                      <div className="space-y-4">
                        {data.findings.map((finding) => (
                          <FindingCard key={finding.id} finding={finding} />
                        ))}
                      </div>
                    </TabsContent>
                    <TabsContent value="severity">
                      <FindingsBySeverity findings={data.findings} />
                    </TabsContent>
                    <TabsContent value="file">
                      <FindingsByFile findings={data.findings} />
                    </TabsContent>
                  </Tabs>
                </>
              ) : data.review ? (
                <div className="rounded-lg border bg-card p-4">
                  <MarkdownRenderer content={data.review} />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <CheckCircle2 className="size-8 text-green-500/50" />
                  <p className="text-sm text-muted-foreground">No issues found in this pull request.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
