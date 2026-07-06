import type { Metadata } from 'next'
import { Newsreader, IBM_Plex_Mono, Inter } from 'next/font/google'
import './globals.css'

// Display: Newsreader — a literary serif, fits legal/editorial gravity without
// the cream-paper cliché. Body: Inter. Data: IBM Plex Mono for the ledger feel.
const display = Newsreader({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-display', style: ['normal', 'italic'] })
const body = Inter({ subsets: ['latin'], variable: '--font-body' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'TruthLens — Legal Claim Verification API',
  description: 'Verify legal claims against statutes and case law. Structured verdicts, real citations, no hallucinated sources.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body style={{ fontFamily: 'var(--font-body)' }}>{children}</body>
    </html>
  )
}
