'use client'

import { useState, useMemo } from 'react'
import { useReposFilters } from '@/hooks/use-repos-filters'
import { useRepos } from '@/data/repos/use-repos'
import RepositoryCard from './repository-card'
import RepositoryRow from './repository-row'
import ReposLoading from './repos-loading'
import EmptyState from '@/components/shared/empty-state'
import ErrorCard from '@/components/error/error-card'
import { FolderGit2, Search, X, LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'

const APP_INSTALLATION_URL = process.env.NEXT_PUBLIC_APP_INSTALLATION_URL || ''

export default function RepositoriesList() {
  const { page, limit } = useReposFilters()
  const { data, isLoading, error } = useRepos(page, limit)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')

  const filtered = useMemo(() => {
    const items = data?.data ?? []
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter((r) => r.full_name.toLowerCase().includes(q))
  }, [data?.data, search])

  if (error) {
    return <ErrorCard title="Unable to load repositories" />
  }

  if (isLoading) {
    return (
      <section className="space-y-4">
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm text-muted-foreground">
          <Search className="size-4" />
          <span>Search repositories...</span>
        </div>
        <ReposLoading />
      </section>
    )
  }

  if (!data || data.data.length === 0) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="No repositories yet"
        description="Connect your GitHub account to get started with AI code review."
      />
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-md border bg-background px-3 text-sm">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            placeholder="Search repositories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent py-2 text-foreground placeholder-muted-foreground outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <Button variant="default" size="lg" onClick={() => window.open(APP_INSTALLATION_URL, '_blank')}>
          + New Repository
        </Button>

        <div className="flex items-center rounded-md border p-0.5">
          <button
            onClick={() => setView('grid')}
            className={`rounded p-1.5 transition-colors ${view === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            aria-label="Grid view"
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            onClick={() => setView('list')}
            className={`rounded p-1.5 transition-colors ${view === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            aria-label="List view"
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No results"
          description={`No repositories matching "${search}"`}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {data.total} repositor{filtered.length !== 1 ? 'ies' : 'y'}
          </p>
          {view === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {filtered.map((repository) => (
                <RepositoryCard key={repository.id} repository={repository} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border">
              <div className="grid grid-cols-[1fr_80px_60px_100px_32px] items-center gap-4 border-b px-4 py-2 text-xs font-medium text-muted-foreground">
                <span>Repository</span>
                <span>Reviews</span>
                <span>Updated</span>
                <span>Monitoring</span>
                <span />
              </div>
              {filtered.map((repository) => (
                <RepositoryRow key={repository.id} repository={repository} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
