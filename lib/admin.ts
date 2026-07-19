import { getAuthedUser } from './auth'

// ponytail: env-var allowlist, not a role column. Fine at this scale — add a
// real roles table if this ever needs more than a handful of trusted emails.
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export async function getAdminUser() {
  const user = await getAuthedUser()
  if (!user?.email) return null
  return adminEmails().includes(user.email.toLowerCase()) ? user : null
}
