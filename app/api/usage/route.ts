import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getAuthedUser } from '@/lib/auth'

export const runtime = 'nodejs'

// Billing dashboard data — monthly rollup of the user's usage logs.
export async function GET() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await getDb().rpc('usage_summary', { p_user_id: user.id })
  if (error) {
    console.error('usage_summary failed', error)
    return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}
