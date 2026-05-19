import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type Props = { count?: number; view?: 'grid' | 'list' }

export default function ReposLoading({ count = 4, view = 'grid' }: Props) {
  if (view === 'list') {
    return (
      <div className="rounded-lg border">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-0">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="size-9 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
