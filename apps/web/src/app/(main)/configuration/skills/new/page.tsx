'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { ArrowLeft, Loader2 } from 'lucide-react'
import ErrorCard from '@/components/error/error-card'

const AGENT_OPTIONS = [
  { value: 'mechanic', label: 'Mechanic Agent' },
  { value: 'review', label: 'Review Agent' },
]

export default function NewSkillPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [useCase, setUseCase] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [targetAgents, setTargetAgents] = useState<string[]>(['mechanic'])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      const res = await fetch('/api/configuration/skills', {
        method: 'POST',
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
        throw new Error(err.error || 'Failed to create skill')
      }

      router.push('/configuration/skills')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  if (error === 'Failed to load') {
    return <ErrorCard title="Unable to load page" />
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold">New Skill</h2>
          <p className="text-sm text-muted-foreground">Create custom instructions for your agents</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Skill Details</CardTitle>
            <CardDescription>Define the skill metadata and instructions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Skill Name</Label>
              <Input
                id="name"
                placeholder="e.g., Security-First Fix"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="useCase">Use Case</Label>
              <Input
                id="useCase"
                placeholder="e.g., When the bug involves security vulnerabilities like injection, XSS, or auth bypass"
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">The agent reads this to decide if the skill applies to the current task.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                placeholder="Brief summary of what this skill does"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
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
                placeholder="Write the skill instructions in markdown...&#10;&#10;## Security-First Fix&#10;&#10;1. Always use parameterized queries&#10;2. Sanitize all user input&#10;3. ..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[300px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                The agent will follow these instructions when it decides this skill matches the task.
              </p>
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
            Create Skill
          </Button>
        </div>
      </form>
    </div>
  )
}
