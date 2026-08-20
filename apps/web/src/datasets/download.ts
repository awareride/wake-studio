/**
 * Datasets — small browser download helpers (ADR-044 §8, #208).
 */

/** Save bytes as a file download (blob URL + <a download>). */
export function downloadBlob(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: 'application/zip',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Fetch a URL and return its bytes (for the backend dataset download). */
export async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}
