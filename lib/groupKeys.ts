/**
 * Maps between app config group keys (yod_a, yod_b, tet) and AD group names
 * as returned by Beast (YOD A, YOD B, TET, HANDESAIM, …).
 *
 * Comparison rule: lowercase + treat `_` and spaces as equivalent.
 */

export function normalizeGroupToken(name: string): string {
  const normalized = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
  return normalized === 'teachers' ? 'morim' : normalized;
}

/** True if config key and AD group name refer to the same team. */
export function groupsMatch(configKey: string, adOrConfigGroup: string): boolean {
  return normalizeGroupToken(configKey) === normalizeGroupToken(adOrConfigGroup);
}

/** User AD groups → config keys from TARGET_GROUPS that they belong to. */
export function configKeysForUserGroups(userGroups: string[], targetKeys: string[]): string[] {
  return targetKeys.filter((key) => userGroups.some((ug) => groupsMatch(key, ug)));
}

/** Config key → best AD label for display (first matching AD name from user list, else key). */
export function primaryAdGroupName(configKey: string, adGroupsSample: string[]): string | null {
  const match = adGroupsSample.find((g) => groupsMatch(configKey, g));
  return match || null;
}
