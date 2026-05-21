import { Suspense } from 'react'
import PullsList from '@/components/pulls/pulls-list'

export default function PullsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Pull Requests</h2>
        <p className="text-sm text-muted-foreground">AI-reviewed pull requests across your repositories</p>
      </div>
      <Suspense fallback={null}>
        <PullsList />
      </Suspense>
    </div>
  )
}
