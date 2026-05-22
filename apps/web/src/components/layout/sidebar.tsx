'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser, SignOutButton } from '@clerk/nextjs'
import { cn } from '@/lib/utils'
import { LayoutDashboard, GitBranch, GitPullRequest, Bug, Wrench, Settings, LogOut } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import Image from 'next/image'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/repos', label: 'Repositories', icon: GitBranch },
  { href: '/pulls', label: 'Pull Requests', icon: GitPullRequest },
  { href: '/issues', label: 'Issues & Alerts', icon: Bug },
  { href: '/fixes', label: 'Fix History', icon: Wrench },
  { href: '/settings', label: 'Settings', icon: Settings },
]

function NavItem({ item, pathname }: { item: (typeof navItems)[number]; pathname: string }) {
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm font-medium',
        isActive
          ? 'text-foreground bg-foreground/5'
          : 'text-muted-foreground hover:text-foreground hover:bg-foreground/3',
      )}
    >
      <item.icon className="size-4 shrink-0" />
      {item.label}
    </Link>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { user } = useUser()

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-full w-56 flex-col border-r lg:flex">
      <div className="flex h-12 items-center gap-2 border-b px-4">
        <Image src="/logo.png" alt="Logo" width={150} height={32} />
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {navItems.map((item) => (
          <NavItem key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>

      <div className="mt-auto border-t px-4 py-3">
        <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar className="size-6 shrink-0">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback className="text-[10px]">
                {user?.firstName?.charAt(0) || 'U'}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{user?.firstName || 'User'}</span>
          </div>
          <SignOutButton>
            <button className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:text-foreground hover:bg-foreground/5 transition-colors">
              <LogOut className="size-3.5" />
              Logout
            </button>
          </SignOutButton>
        </div>
      </div>
    </aside>
  )
}
