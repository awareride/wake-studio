/**
 * Datasets — "Train with this" link seam (ADR-044 §8, #208).
 *
 * "Train with this" navigates to the Training view with a dataset
 * pre-picked. The two views live on different routes, so the picked dataset
 * id is handed over through sessionStorage: the Datasets console writes it,
 * the New-train wizard consumes it on mount and seeds its `datasets[]`
 * picker. Cleared after consumption so it never leaks into a later train.
 */

const KEY = 'wake-studio:datasets:pending-train'

/** Remember the dataset the user wants to train with next. */
export function setPendingTrainDataset(id: string): void {
  try {
    sessionStorage.setItem(KEY, id)
  } catch {
    /* storage unavailable (private mode) — the picker is not pre-seeded */
  }
}

/** Read + clear the pending dataset id (call once when the wizard mounts). */
export function consumePendingTrainDataset(): string | null {
  try {
    const id = sessionStorage.getItem(KEY)
    if (id) sessionStorage.removeItem(KEY)
    return id
  } catch {
    return null
  }
}
