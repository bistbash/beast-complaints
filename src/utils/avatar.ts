export function avatarUrl(user: { username?: string; avatarUrl?: string | null } | null | undefined): string | null {
  if (!user) return null;
  if (user.avatarUrl) return user.avatarUrl;
  return null;
}
