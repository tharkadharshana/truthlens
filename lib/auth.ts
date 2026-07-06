import { serverClient } from './db'

// Fix vs v1: getSession() reads the cookie WITHOUT verifying the JWT — a forged
// cookie passes. getUser() validates against the Supabase auth server. Always
// use this for authorization decisions in server code.
export async function getAuthedUser() {
  const supabase = await serverClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user
}
