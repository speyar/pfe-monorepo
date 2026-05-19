import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { ClerkProvider } from '@clerk/nextjs'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import SWRProvider from '@/components/providers/swr-provider'
import { TooltipProvider } from '@/components/ui/tooltip'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Falcon',
  description: 'AI-powered code review and monitoring platform',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${geistSans.className} antialiased`}
      >
        <NuqsAdapter>
          <SWRProvider>
            <ClerkProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </ClerkProvider>
          </SWRProvider>
        </NuqsAdapter>
      </body>
    </html>
  )
}
