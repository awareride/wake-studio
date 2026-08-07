/**
 * Microphone device enumeration (epic #53 P2).
 *
 * Wraps `navigator.mediaDevices.enumerateDevices()` for the input-source
 * selector: audioinput devices, grouped by groupId (physical device), with
 * labels when permission has been granted. A `devicechange` subscription keeps
 * the list live (device hotplug).
 *
 * Labels are blank until the user grants mic permission, so the caller can
 * trigger a silent one-shot `getUserMedia` (then stop tracks) to populate
 * them, or surface a "permission needed" hint.
 */

/** One selectable microphone. */
export interface MicDevice {
  deviceId: string
  /** Human label ('' when permission not granted). */
  label: string
  /** Physical-device group id (multiple ports of one mic share it). */
  groupId: string
}

/**
 * Enumerate microphone input devices. Returns [] when the MediaDevices API is
 * unavailable (e.g. insecure context) or enumerateDevices throws.
 */
export async function enumerateMicDevices(): Promise<MicDevice[]> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.enumerateDevices !== 'function'
  ) {
    return []
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label || '',
        groupId: d.groupId,
      }))
  } catch {
    return []
  }
}

/** Whether at least one enumerated device has a usable label. */
export function hasDeviceLabels(devices: MicDevice[]): boolean {
  return devices.some((d) => d.label.length > 0)
}

/**
 * Subscribe to device changes (hotplug / permission changes). Returns an
 * unsubscribe function. Safe when MediaDevices is unavailable.
 */
export function onDeviceChange(cb: () => void): () => void {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.addEventListener !== 'function'
  ) {
    return () => {}
  }
  navigator.mediaDevices.addEventListener('devicechange', cb)
  return () => navigator.mediaDevices.removeEventListener('devicechange', cb)
}

/**
 * Request mic permission once and stop the tracks immediately, so subsequent
 * enumerateDevices() calls return labels. Resolves true when permission was
 * granted, false when denied/unavailable. Never throws.
 */
export async function requestMicPermission(): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return false
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}
