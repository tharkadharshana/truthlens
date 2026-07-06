import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import DashboardClient from './DashboardClient'

// Server component: authoritative auth check (validates JWT via getUser).
// proxy.ts only did an optimistic cookie check — this is the real gate.
export default async function DashboardPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login?next=/dashboard')
  return <DashboardClient />
}
