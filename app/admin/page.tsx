import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { getAdminUser } from '@/lib/admin'
import AdminClient from './AdminClient'

// Server component: authoritative guard, same pattern as dashboard/page.tsx.
// Two distinct redirects: logged out -> login; logged in but not an admin ->
// dashboard (sending them back to login would just loop).
export default async function AdminPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login?next=/admin')
  const admin = await getAdminUser()
  if (!admin) redirect('/dashboard')
  return <AdminClient />
}
