'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

const labelMap: Record<string, string> = {
  dashboard: 'Dashboard',
  repos: 'Repositories',
  pulls: 'Pull Requests',
  monitoring: 'Monitoring',
  alerts: 'Alerts',
  integrations: 'Integrations',
  settings: 'Settings',
}

export function Topbar() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-center border-b bg-background/80 px-6 backdrop-blur-sm">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        {segments.map((seg, i) => {
          const href = '/' + segments.slice(0, i + 1).join('/')
          const label = labelMap[seg] || seg.charAt(0).toUpperCase() + seg.slice(1)
          const isLast = i === segments.length - 1

          return (
            <span key={href} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3" />}
              {isLast ? (
                <span className="text-foreground">{label}</span>
              ) : (
                <Link href={href} className="hover:text-foreground transition-colors">
                  {label}
                </Link>
              )}
            </span>
          )
        })}
      </nav>
    </header>
  )
}
