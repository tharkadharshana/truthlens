import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getAdminUser } from '@/lib/admin'

export const runtime = 'nodejs'

// Flagged = rate-limited or errored requests — the signal worth an admin's
// attention. Not all usage; the dashboard's per-user view already covers that.
export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await getDb()
    .from('usage_logs')
    .select('id, identifier, tier, endpoint, status_code, created_at')
    .gte('status_code', 400)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 })
  return NextResponse.json(data ?? [])
}
