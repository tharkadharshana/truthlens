import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const service = () => process.env.SUPABASE_SERVICE_ROLE_KEY!

// Service-role client — SERVER ONLY. Bypasses RLS. Never import into client code.
// ponytail: lazy singleton. Constructing at import time crashes the build during
// page-data collection when env vars are absent. Build on first use instead.
let _db: SupabaseClient | null = null
export function getDb(): SupabaseClient {
  if (!_db) {
    _db = createClient(url(), service(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _db
}

// Auth-aware client for Route Handlers / Server Components.
// set/remove actually write cookies so session refresh works and getUser()
// can validate the JWT against the auth server.
export async function serverClient() {
  const store = await cookies()  // Next 16: cookies() is async
  return createServerClient(url(), anon(), {
    cookies: {
      get: (name: string) => store.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => {
        try { store.set({ name, value, ...options }) } catch { /* called from RSC render — safe to ignore */ }
      },
      remove: (name: string, options: CookieOptions) => {
        try { store.set({ name, value: '', ...options }) } catch { /* same */ }
      },
    },
  })
}
