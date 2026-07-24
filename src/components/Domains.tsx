const DOMAINS = [
  {
    name: 'Low-power / MCU',
    chips: ['ESP32-S3', 'STM32'],
    kws: 'microWakeWord + TFLite-Micro',
    afe: 'ESP-SR (AEC/NS/BSS)',
    note: 'Traditional classification KWS. First golden-path target.',
  },
  {
    name: 'High-performance',
    chips: ['Linux / Pi', 'Android'],
    kws: 'WavLM Few-Shot + openWakeWord',
    afe: 'RNNoise + WebRTC AEC',
    note: 'Few-Shot metric learning. User-defined wake words.',
  },
]

export function Domains() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">Two domains</h2>
        <p className="text-sm text-slate-400">
          Different targets use different KWS stacks (R6 / R8).
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {DOMAINS.map((d) => (
          <div
            key={d.name}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{d.name}</h3>
              {d.chips.map((c) => (
                <span
                  key={c}
                  className="rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-300"
                >
                  {c}
                </span>
              ))}
            </div>
            <dl className="space-y-1 text-xs text-slate-400">
              <div>
                <dt className="inline font-medium text-slate-300">KWS: </dt>
                <dd className="inline">{d.kws}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-slate-300">AFE: </dt>
                <dd className="inline">{d.afe}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">{d.note}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
