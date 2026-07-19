import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getAuthedUser } from '@/lib/auth'

export const runtime = 'nodejs'

const PAGE_SIZE = 20

// Check history for signed-in dashboard users: their keys' checks, newest first.
// Anonymous checks (null api_key_id) are never returned — they belong to no user.
export async function GET(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const page = Math.max(0, Number(req.nextUrl.searchParams.get('page') ?? 0) || 0)
  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const db = getDb()
  const { data: keys, error: keyErr } = await db.from('api_keys').select('id').eq('user_id', user.id)
  if (keyErr) {
    console.error('history: key lookup failed', keyErr)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }
  const keyIds = (keys ?? []).map((k) => k.id)
  if (!keyIds.length) return NextResponse.json({ checks: [], page, has_more: false })

  const { data, error } = await db
    .from('checks')
    .select('id, domain, input_text, overall_score, response, created_at')
    .in('api_key_id', keyIds)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('history: checks query failed', error)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }

  return NextResponse.json({
    checks: data ?? [],
    page,
    has_more: (data?.length ?? 0) === PAGE_SIZE,
  })
}
