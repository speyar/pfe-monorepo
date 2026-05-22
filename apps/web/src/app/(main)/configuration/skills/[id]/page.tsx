'use client'

import { useState, use } from 'react'
import useSWR from 'swr'
import fetcher from '@/lib/fetcher'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Loader2 } from 'lucide-react'
import ErrorCard from '@/components/error/error-card'

const AGENT_OPTIONS = [
  { value: 'mechanic', label: 'Mechanic Agent' },
  { value: 'review', label: 'Review Agent' },
]

type SkillResponse = {
  data: {
    id: string
    name: string
    useCase: string
    description: string
    content: string
    targetAgents: string[]
  }
}

export default function EditSkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useSWR<SkillResponse>(
    `/api/configuration/skills/${id}`,
    fetcher,
  )

  const [name, setName] = useState('')
  const [useCase, setUseCase] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [targetAgents, setTargetAgents] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  // Set form state once data is loaded
  if (data && !loaded) {
    setName(data.data.name)
    setUseCase(data.data.useCase)
    setDescription(data.data.description)
    setContent(data.data.content)
    setTargetAgents(data.data.targetAgents)
    setLoaded(true)
  }

  const toggleAgent = (agent: string) => {
    setTargetAgents((prev) =>
      prev.includes(agent) ? prev.filter((a) => a !== agent) : [...prev, agent],
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !useCase.trim() || !description.trim() || !content.trim() || targetAgents.length === 0) {
      setError('All fields are required.')
      return
    }
    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/configuration/skills/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          useCase: useCase.trim(),
          description: description.trim(),
          content: content.trim(),
          targetAgents,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update skill')
      }

      router.push('/configuration/skills')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-md" />
          <div className="space-y-1">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) {
    return <ErrorCard title="Skill not found" />
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold">Edit Skill</h2>
          <p className="text-sm text-muted-foreground">Update custom instructions for your agents</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Skill Details</CardTitle>
            <CardDescription>Modify the skill metadata and instructions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Skill Name</Label>
              <Input id="name" placeholder="e.g., Security-First Fix" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="useCase">Use Case</Label>
              <Input id="useCase" placeholder="When should this skill be applied?" value={useCase} onChange={(e) => setUseCase(e.target.value)} />
              <p className="text-xs text-muted-foreground">The agent reads this to decide if the skill applies to the current task.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input id="description" placeholder="Brief summary of what this skill does" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Target Agents</Label>
              <div className="flex gap-2">
                {AGENT_OPTIONS.map((agent) => (
                  <button
                    key={agent.value}
                    type="button"
                    onClick={() => toggleAgent(agent.value)}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                      targetAgents.includes(agent.value)
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border text-muted-foreground hover:border-foreground/50'
                    }`}
                  >
                    {agent.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">Instructions (Markdown)</Label>
              <Textarea
                id="content"
                placeholder="Write the skill instructions in markdown..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[300px] font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </form>
    </div>
  )
}
