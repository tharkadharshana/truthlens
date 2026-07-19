import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getAdminUser } from '@/lib/admin'

export const runtime = 'nodejs'

export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Never return key_hash. profiles(email) relies on the api_keys.user_id FK.
  const { data, error } = await getDb()
    .from('api_keys')
    .select('id, key_prefix, tier, created_at, last_used_at, revoked, profiles(email)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: 'Failed to list keys' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function DELETE(req: NextRequest) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  // Admin revoke has no ownership guard by design — that's the point of admin.
  const { error } = await getDb().from('api_keys').update({ revoked: true }).eq('id', body.id)
  if (error) return NextResponse.json({ error: 'Failed to revoke' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
