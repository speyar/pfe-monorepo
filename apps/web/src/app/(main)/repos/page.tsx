import { Suspense } from 'react'
import RepositoriesList from '@/components/github/repositories-list'

export default function RepositoriesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Repositories</h2>
        <p className="text-sm text-muted-foreground">Manage your connected repositories</p>
      </div>
      <Suspense fallback={null}>
        <RepositoriesList />
      </Suspense>
    </div>
  )
}
