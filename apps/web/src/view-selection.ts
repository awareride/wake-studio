/**
 * Per-view selected-item memory (issue #139).
 *
 * Views unmount when the route changes, so a list-detail selection (selected
 * train / backend / project) is lost on every view switch. This tiny
 * sessionStorage-backed store remembers the last selected id per view key;
 * views restore it on mount and update it on selection change.
 *
 * sessionStorage (not module state) so the selection also survives a reload
 * in the same tab; it clears when the tab closes.
 */

const PREFIX = 'wake-studio:view-selection:'

/** Remember the selected item for a view; pass null to clear it. */
export function rememberSelection(key: string, id: string | null): void {
  try {
    if (id === null || id === '') sessionStorage.removeItem(PREFIX + key)
    else sessionStorage.setItem(PREFIX + key, id)
  } catch {
    // Storage unavailable (private mode): selection just won't survive reloads.
  }
}

/** The last remembered selected item for a view, or null. */
export function rememberedSelection(key: string): string | null {
  try {
    return sessionStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}
