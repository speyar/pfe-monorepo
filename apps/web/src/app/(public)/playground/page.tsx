'use client'

import {
  BellIcon,
  ChevronRightIcon,
  CodeIcon,
  GlobeIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const sections = [
  { id: 'colors', label: 'Colors' },
  { id: 'typography', label: 'Typography' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'badges', label: 'Badges' },
  { id: 'cards', label: 'Cards' },
  { id: 'forms', label: 'Forms' },
  { id: 'tabs', label: 'Tabs' },
  { id: 'dialog', label: 'Dialog' },
  { id: 'dropdown', label: 'Dropdown' },
  { id: 'tooltip', label: 'Tooltip' },
  { id: 'avatar', label: 'Avatar' },
  { id: 'skeleton', label: 'Skeleton' },
]

const colorTokens = [
  { name: 'background', var: 'var(--background)' },
  { name: 'foreground', var: 'var(--foreground)' },
  { name: 'card', var: 'var(--card)' },
  { name: 'popover', var: 'var(--popover)' },
  { name: 'primary', var: 'var(--primary)' },
  { name: 'primary-foreground', var: 'var(--primary-foreground)' },
  { name: 'secondary', var: 'var(--secondary)' },
  { name: 'muted', var: 'var(--muted)' },
  { name: 'muted-foreground', var: 'var(--muted-foreground)' },
  { name: 'accent', var: 'var(--accent)' },
  { name: 'destructive', var: 'var(--destructive)' },
  { name: 'border', var: 'var(--border)' },
  { name: 'input', var: 'var(--input)' },
  { name: 'ring', var: 'var(--ring)' },
]

function SectionNav({ activeId }: { activeId: string }) {
  return (
    <nav className="fixed top-0 left-0 z-40 hidden h-full w-56 border-r bg-sidebar p-4 lg:block">
      <div className="mb-6 flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
          F
        </div>
        <span className="text-sm font-semibold">Falcon DS</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            data-active={activeId === s.id ? true : undefined}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground data-active:bg-accent data-active:text-accent-foreground"
          >
            <ChevronRightIcon className="size-3" />
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-6 text-xl font-semibold tracking-tight">{children}</h2>
}

function DemoGrid({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-start gap-3">{children}</div>
}

function ColorSwatch({ name, colorVar }: { name: string; colorVar: string }) {
  return (
    <div className="flex w-36 flex-col items-center gap-2">
      <div
        className="h-16 w-full rounded-lg ring-1 ring-foreground/10"
        style={{ backgroundColor: colorVar }}
      />
      <span className="text-xs font-medium text-muted-foreground">{name}</span>
    </div>
  )
}

export default function PlaygroundPage() {
  const [activeSection, setActiveSection] = useState('colors')

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px' },
    )
    for (const s of sections) {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <SectionNav activeId={activeSection} />

      <div className="lg:pl-56">
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-sm">
          <div className="flex h-12 items-center justify-between px-4 lg:px-8">
            <div className="flex items-center gap-2 lg:hidden">
              <div className="flex size-6 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">
                F
              </div>
              <span className="text-sm font-semibold">Falcon DS</span>
            </div>
            <div className="hidden lg:flex lg:flex-1" />
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                v0.1
              </Badge>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-10 lg:px-8">
          {/* Hero */}
          <div className="mb-16">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="outline" className="border-primary/30 text-primary">
                Design System
              </Badge>
            </div>
            <h1 className="mb-2 text-3xl font-bold tracking-tight lg:text-4xl">Falcon</h1>
            <p className="max-w-xl text-muted-foreground">
              Premium design system for AI-powered code review and monitoring. Iterate on tokens and
              components here before applying to pages.
            </p>
          </div>

          {/* Colors */}
          <section id="colors" className="mb-16 scroll-mt-16">
            <SectionTitle>Colors</SectionTitle>
            <p className="mb-4 text-sm text-muted-foreground">
              OKLCH color space with blue-indigo hue (260°) for a cohesive premium feel.
            </p>
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-medium">Dark Theme</h3>
              <div className="flex flex-wrap gap-3">
                {colorTokens.map((c) => (
                  <ColorSwatch key={c.name} name={c.name} colorVar={c.var} />
                ))}
              </div>
            </div>
          </section>

          <Separator className="mb-16" />

          {/* Typography */}
          <section id="typography" className="mb-16 scroll-mt-16">
            <SectionTitle>Typography</SectionTitle>
            <p className="mb-6 text-sm text-muted-foreground">
              Geist Sans & Geist Mono — variable fonts from Vercel.
            </p>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Heading 1</p>
                <p className="text-4xl font-bold tracking-tight">The quick brown fox</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Heading 2</p>
                <p className="text-2xl font-bold tracking-tight">The quick brown fox</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Heading 3</p>
                <p className="text-xl font-semibold">The quick brown fox</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Body</p>
                <p className="text-sm">
                  The quick brown fox jumps over the lazy dog. This is the body text used throughout
                  the application at 14px.
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Small / Muted</p>
                <p className="text-xs text-muted-foreground">
                  The quick brown fox jumps over the lazy dog.
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Monospace</p>
                <p className="font-mono text-sm">const falcon = {'"premium"'};</p>
              </div>
            </div>
          </section>

          <Separator className="mb-16" />

          {/* Buttons */}
          <section id="buttons" className="mb-16 scroll-mt-16">
            <SectionTitle>Buttons</SectionTitle>
            <div className="space-y-8">
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">Variants</h3>
                <DemoGrid>
                  <Button variant="default">Default</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="destructive">Destructive</Button>
                  <Button variant="link">Link</Button>
                </DemoGrid>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">Sizes</h3>
                <DemoGrid>
                  <Button size="xs">Extra Small</Button>
                  <Button size="sm">Small</Button>
                  <Button size="default">Default</Button>
                  <Button size="lg">Large</Button>
                </DemoGrid>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">With icons</h3>
                <DemoGrid>
                  <Button>
                    <PlusIcon />
                    Add
                  </Button>
                  <Button variant="outline">
                    <SettingsIcon />
                    Settings
                  </Button>
                  <Button variant="outline">
                    <SearchIcon />
                    Search
                  </Button>
                  <Button size="icon" aria-label="Settings">
                    <SettingsIcon />
                  </Button>
                  <Button size="icon-sm" aria-label="Add">
                    <PlusIcon />
                  </Button>
                  <Button size="icon-lg" aria-label="Notifications">
                    <BellIcon />
                  </Button>
                </DemoGrid>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">States</h3>
                <DemoGrid>
                  <Button disabled>Disabled</Button>
                  <Button variant="outline" disabled>
                    Disabled
                  </Button>
                  <Button className="cursor-progress">
                    <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Loading
                  </Button>
                </DemoGrid>
              </div>
            </div>
          </section>

          <Separator className="mb-16" />

          {/* Badges */}
          <section id="badges" className="mb-16 scroll-mt-16">
            <SectionTitle>Badges</SectionTitle>
            <div className="space-y-6">
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">Variants</h3>
                <DemoGrid>
                  <Badge variant="default">default</Badge>
                  <Badge variant="secondary">secondary</Badge>
                  <Badge variant="destructive">destructive</Badge>
                  <Badge variant="outline">outline</Badge>
                  <Badge variant="ghost">ghost</Badge>
                  <Badge variant="link">link</Badge>
                </DemoGrid>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">With icons</h3>
                <DemoGrid>
                  <Badge>
                    <ZapIcon />
                    Fast
                  </Badge>
                  <Badge variant="secondary">
                    <ShieldIcon />
                    Secure
                  </Badge>
                  <Badge variant="outline">
                    <GlobeIcon />
                    Global
                  </Badge>
                  <Badge variant="destructive">
                    <XIcon />
                    Error
                  </Badge>
                </DemoGrid>
              </div>
            </div>
          </section>

          <Separator className="mb-16" />

          {/* Cards */}
          <section id="cards" className="mb-16 scroll-mt-16">
            <SectionTitle>Cards</SectionTitle>
            <div className="space-y-8">
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">Default</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>Repository Overview</CardTitle>
                      <CardDescription>View and manage your connected repositories</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        12 repositories connected. 3 with active monitoring.
                      </p>
                    </CardContent>
                    <CardFooter>
                      <Button size="sm">
                        View All
                        <ChevronRightIcon />
                      </Button>
                    </CardFooter>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>With Action</CardTitle>
                      <CardAction>
                        <Button size="icon-sm" variant="ghost" aria-label="Settings">
                          <SettingsIcon />
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Cards can have action buttons in the header.
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">Small</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle>Issues</CardTitle>
                      <CardDescription>Open issues</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">23</p>
                    </CardContent>
                  </Card>
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle>Reviews</CardTitle>
                      <CardDescription>Pending review</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">7</p>
                    </CardContent>
                  </Card>
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle>Deploys</CardTitle>
                      <CardDescription>This week</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">12</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </section>

          <Separator className="mb-16" />

          {/* Forms */}
          <section id="forms" className="mb-16 scroll-mt-16">
            <SectionTitle>Forms</SectionTitle>
            <div className="space-y-8">
              <div className="grid max-w-md gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="you@example.com" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="name">Full Name</Label>
                  <Input id="name" placeholder="John Doe" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="bio">Bio</Label>
                  <Textarea id="bio" placeholder="Tell us about yourself..." rows={3} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="role">Role</Label>
                  <Select defaultValue="developer">
                    <SelectTrigger id="role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="developer">Developer</SelectItem>
                      <SelectItem value="designer">Designer</SelectItem>
                      <SelectItem value="pm">Product Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="disabled">Disabled</Label>
                  <Input id="disabled" disabled value="Can't touch this" />
                </div>
                <div className="flex gap-2">
                  <Button>Save Changes</Button>
                  <Button variant="outline">Cancel</Button>
                </div>
              </div>
            </div>
          </section>

          <Separator className="mb-16" />

          {/* Tabs */}
          <section id="tabs" className="mb-16 scroll-mt-16">
            <SectionTitle>Tabs</SectionTitle>
            <div className="space-y-8">
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">Default variant</h3>
                <Tabs defaultValue="tab1">
                  <TabsList>
                    <TabsTrigger value="tab1">Overview</TabsTrigger>
                    <TabsTrigger value="tab2">Commits</TabsTrigger>
                    <TabsTrigger value="tab3">Issues</TabsTrigger>
                  </TabsList>
                  <TabsContent value="tab1" className="mt-4">
                    <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                      Overview content — showing repository statistics and recent activity.
                    </div>
                  </TabsContent>
                  <TabsContent value="tab2" className="mt-4">
                    <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                      Commits content — recent commits across all branches.
                    </div>
                  </TabsContent>
                  <TabsContent value="tab3" className="mt-4">
                    <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                      Issues content — open and closed issue tracker.
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">Line variant</h3>
                <Tabs defaultValue="tab1">
                  <TabsList variant="line">
                    <TabsTrigger value="tab1">Overview</TabsTrigger>
                    <TabsTrigger value="tab2">Commits</TabsTrigger>
                    <TabsTrigger value="tab3">Issues</TabsTrigger>
                  </TabsList>
                  <TabsContent value="tab1" className="mt-4">
                    <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                      Overview content with line-style tabs.
                    </div>
                  </TabsContent>
                  <TabsContent value="tab2" className="mt-4">
                    <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                      Commits content with line-style tabs.
                    </div>
                  </TabsContent>
                  <TabsContent value="tab3" className="mt-4">
                    <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                      Issues content with line-style tabs.
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </section>

          <Separator className="mb-16" />

          {/* Dialog */}
          <section id="dialog" className="mb-16 scroll-mt-16">
            <SectionTitle>Dialog</SectionTitle>
            <Dialog>
              <DialogTrigger render={<Button>Open Dialog</Button>} />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm Review</DialogTitle>
                  <DialogDescription>
                    This will submit your code review for the pull request. The author will be
                    notified of your feedback.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
                  <CodeIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Reviewing 12 files across 3 packages
                  </span>
                </div>
                <DialogFooter showCloseButton>
                  <Button variant="outline">Cancel</Button>
                  <Button>Submit Review</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </section>

          <Separator className="mb-16" />

          {/* Dropdown */}
          <section id="dropdown" className="mb-16 scroll-mt-16">
            <SectionTitle>Dropdown Menu</SectionTitle>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline">Open Menu</Button>} />
              <DropdownMenuContent className="w-48">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <UserIcon />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <SettingsIcon />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <BellIcon />
                  Notifications
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </section>

          <Separator className="mb-16" />

          {/* Tooltip */}
          <section id="tooltip" className="mb-16 scroll-mt-16">
            <SectionTitle>Tooltip</SectionTitle>
            <DemoGrid>
              <Tooltip>
                <TooltipTrigger render={<Button variant="outline">Hover me</Button>} />
                <TooltipContent>
                  <p>This is a tooltip</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button size="icon" variant="ghost" aria-label="Settings">
                      <SettingsIcon />
                    </Button>
                  }
                />
                <TooltipContent side="right">
                  <p>Settings</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button size="icon" variant="ghost" aria-label="Notifications">
                      <BellIcon />
                    </Button>
                  }
                />
                <TooltipContent side="bottom">
                  <p>Notifications</p>
                </TooltipContent>
              </Tooltip>
            </DemoGrid>
          </section>

          <Separator className="mb-16" />

          {/* Avatar */}
          <section id="avatar" className="mb-16 scroll-mt-16">
            <SectionTitle>Avatar</SectionTitle>
            <div className="space-y-6">
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">Sizes</h3>
                <DemoGrid>
                  <Avatar size="sm">
                    <AvatarFallback>JD</AvatarFallback>
                  </Avatar>
                  <Avatar>
                    <AvatarFallback>JD</AvatarFallback>
                  </Avatar>
                  <Avatar size="lg">
                    <AvatarFallback>JD</AvatarFallback>
                  </Avatar>
                </DemoGrid>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium text-muted-foreground">With image</h3>
                <DemoGrid>
                  <Avatar>
                    <AvatarImage src="https://github.com/github.png" alt="@github" />
                    <AvatarFallback>GH</AvatarFallback>
                  </Avatar>
                  <Avatar>
                    <AvatarImage src="https://github.com/vercel.png" alt="@vercel" />
                    <AvatarFallback>VC</AvatarFallback>
                  </Avatar>
                </DemoGrid>
              </div>
            </div>
          </section>

          <Separator className="mb-16" />

          {/* Skeleton */}
          <section id="skeleton" className="mb-16 scroll-mt-16">
            <SectionTitle>Skeleton</SectionTitle>
            <div className="max-w-md space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-24 w-full rounded-xl" />
              <div className="flex gap-2">
                <Skeleton className="h-8 flex-1" />
                <Skeleton className="h-8 w-20" />
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
