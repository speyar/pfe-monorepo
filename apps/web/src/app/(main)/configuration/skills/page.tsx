'use client'

import { useState } from 'react'
import useSWR from 'swr'
import fetcher from '@/lib/fetcher'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, BookMarked, Pencil, Trash2, Search, X } from 'lucide-react'
import EmptyState from '@/components/shared/empty-state'
import ErrorCard from '@/components/error/error-card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Skill = {
  id: string
  name: string
  useCase: string
  description: string
  content: string
  targetAgents: string[]
  userId: string
  createdAt: string
  updatedAt: string
}

type SkillsResponse = { data: Skill[] }

const AGENT_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' }> = {
  mechanic: { label: 'Mechanic', variant: 'default' },
  review: { label: 'Review', variant: 'secondary' },
}

const AGENT_FILTERS = [
  { value: '', label: 'All agents' },
  { value: 'mechanic', label: 'Mechanic' },
  { value: 'review', label: 'Review' },
]

function SkillRow({ skill, onDelete }: { skill: Skill; onDelete: (id: string) => void }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete "${skill.name}"?`)) return
    setDeleting(true)
    try {
      await fetch(`/api/configuration/skills/${skill.id}`, { method: 'DELETE' })
      onDelete(skill.id)
    } catch {
      alert('Failed to delete skill')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      onClick={() => router.push(`/configuration/skills/${skill.id}`)}
      className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-foreground/[0.02] transition-colors"
    >
      <BookMarked className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{skill.name}</p>
          <div className="flex gap-1">
            {skill.targetAgents.map((agent) => {
              const cfg = AGENT_LABELS[agent] ?? { label: agent, variant: 'secondary' as const }
              return (
                <Badge key={agent} variant={cfg.variant} className="text-[10px] capitalize">
                  {cfg.label}
                </Badge>
              )
            })}
          </div>
        </div>
        <p className="truncate text-xs text-muted-foreground mt-0.5">{skill.description}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); router.push(`/configuration/skills/${skill.id}`) }}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

export default function SkillsPage() {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const router = useRouter()

  const { data, isLoading, error, mutate } = useSWR<SkillsResponse>(
    '/api/configuration/skills',
    fetcher,
  )

  const filtered = (data?.data ?? []).filter((skill) => {
    if (search && !skill.name.toLowerCase().includes(search.toLowerCase()) && !skill.description.toLowerCase().includes(search.toLowerCase())) {
      return false
    }
    if (agentFilter && !skill.targetAgents.includes(agentFilter)) {
      return false
    }
    return true
  })

  const handleDelete = (id: string) => {
    mutate((prev) => prev ? { ...prev, data: prev.data.filter((s) => s.id !== id) } : prev, false)
  }

  if (error) {
    return <ErrorCard title="Unable to load skills" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Skills</h2>
          <p className="text-sm text-muted-foreground">
            Custom instructions that enhance agent behavior. Create skills and agents will apply them when the use case matches.
          </p>
        </div>
        <Button onClick={() => router.push('/configuration/skills/new')} className="gap-1.5">
          <Plus className="size-4" />
          New Skill
        </Button>
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border bg-background px-3 text-sm h-9">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              placeholder="Search skills..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setSearch(searchInput) }}
              className="w-full bg-transparent py-2 text-foreground placeholder-muted-foreground outline-none"
            />
            {searchInput && (
              <button onClick={() => { setSearchInput(''); setSearch('') }} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            )}
          </div>
          <Select value={agentFilter} onValueChange={(v) => setAgentFilter(v ?? '')}>
            <SelectTrigger className="w-[160px] !h-9">
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              {AGENT_FILTERS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="divide-y rounded-lg border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-4 rounded" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={BookMarked}
            title={search || agentFilter ? 'No results' : 'No skills yet'}
            description={
              search || agentFilter
                ? 'Try adjusting your search or filters.'
                : 'Create a skill to provide custom instructions for your agents.'
            }
            action={
              !search && !agentFilter ? (
                <Button onClick={() => router.push('/configuration/skills/new')} className="gap-1.5">
                  <Plus className="size-4" />
                  Create your first skill
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="divide-y rounded-lg border">
            {filtered.map((skill) => (
              <SkillRow key={skill.id} skill={skill} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
