/**
 * Microphone source selector (epic #53 P2).
 *
 * Lets the user pick the input device (auto-enumerated, live-updating on
 * hotplug) and per-device browser DSP options (echo cancellation / noise
 * suppression / auto gain control) + channel count. The resulting
 * MicSourceConfig feeds AFEPipeline.start(source).
 *
 * Lives above the AFE panel's Start control for now; the Workspace
 * config-first layout (epic #53 P7) moves it into Step A.
 */

import { useCallback, useEffect, useState } from 'react'
import type { MicSourceConfig } from '@wake-studio/module-afe-graph'
import { Button, Card, Checkbox } from '@radix-ui/themes'
import {
  enumerateMicDevices,
  hasDeviceLabels,
  onDeviceChange,
  requestMicPermission,
} from '../workspace/sources/deviceList'
import type { MicDevice } from '../workspace/sources/deviceList'

interface Props {
  /** Current value (from the workspace/project snapshot). */
  value: MicSourceConfig
  onChange: (next: MicSourceConfig) => void
  disabled?: boolean
}

function ToggleRow({
  label,
  hint,
  checked,
  onChecked,
  disabled,
}: {
  label: string
  hint: string
  checked: boolean
  onChecked: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChecked(v === true)}
        size="1"
      />
      <span className="text-ink-2">{label}</span>
      <span className="text-[10px] text-ink-3">{hint}</span>
    </label>
  )
}

export function SourceSelector({ value, onChange, disabled }: Props) {
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [permissionGranted, setPermissionGranted] = useState(false)

  const refresh = useCallback(async () => {
    const mics = await enumerateMicDevices()
    setDevices(mics)
    setPermissionGranted(hasDeviceLabels(mics))
  }, [])

  // Initial load + live hotplug refresh.
  useEffect(() => {
    void refresh()
    const off = onDeviceChange(() => void refresh())
    return off
  }, [refresh])

  const handleRequestPermission = useCallback(async () => {
    const granted = await requestMicPermission()
    if (granted) void refresh()
    else setPermissionGranted(false)
  }, [refresh])

  // Keep the selected device valid: if the current deviceId disappeared,
  // fall back to the first available device.
  useEffect(() => {
    if (devices.length === 0) return
    if (value.deviceId && devices.some((d) => d.deviceId === value.deviceId)) {
      return
    }
    onChange({ ...value, deviceId: devices[0].deviceId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices])

  return (
    <Card className="flex flex-wrap items-center gap-x-5 gap-y-3 !p-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-ink-2">Input device</span>
        <select
          value={value.deviceId ?? ''}
          disabled={disabled || devices.length === 0}
          onChange={(e) => onChange({ ...value, deviceId: e.target.value || undefined })}
          className="max-w-72 truncate rounded bg-surface-3 px-2.5 py-1 text-sm text-ink-1"
        >
          {devices.length === 0 && <option value="">Default device</option>}
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microphone (${d.deviceId.slice(0, 8)}…)`}
            </option>
          ))}
        </select>
      </label>

      {devices.length > 0 && !permissionGranted && (
        <Button
          onClick={handleRequestPermission}
          disabled={disabled}
          size="1"
        >
          Allow mic to see device names
        </Button>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <ToggleRow
          label="AEC"
          hint="(browser)"
          checked={value.echoCancellation ?? false}
          onChecked={(v) => onChange({ ...value, echoCancellation: v })}
          disabled={disabled}
        />
        <ToggleRow
          label="NS"
          hint="(browser)"
          checked={value.noiseSuppression ?? false}
          onChecked={(v) => onChange({ ...value, noiseSuppression: v })}
          disabled={disabled}
        />
        <ToggleRow
          label="AGC"
          hint="(browser)"
          checked={value.autoGainControl ?? false}
          onChecked={(v) => onChange({ ...value, autoGainControl: v })}
          disabled={disabled}
        />
        <ToggleRow
          label="Monitor"
          hint="(speaker)"
          checked={value.monitor ?? false}
          onChecked={(v) => onChange({ ...value, monitor: v })}
          disabled={disabled}
        />
        <label className="flex items-center gap-2 text-xs">
          <span className="text-ink-2">Channels</span>
          <select
            value={value.channelCount ?? 1}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, channelCount: Number(e.target.value) as 1 | 2 })
            }
            className="rounded bg-surface-3 px-1.5 py-0.5 text-xs text-ink-1"
          >
            <option value={1}>Mono</option>
            <option value={2}>Stereo</option>
          </select>
        </label>
      </div>

      <p className="w-full text-[10px] text-ink-3">
        Browser DSP is off by default — our RNNoise is the only noise
        suppressor. Toggle browser AEC/NS/AGC to let the device do it instead.
      </p>

      {value.monitor && (
        <p className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
          ⚠️ Monitor is on: mic audio plays through your speakers. Without
          headphones the speakers feed back into the mic (feedback noise) —
          wear headphones or turn Monitor off.
        </p>
      )}
    </Card>
  )
}
