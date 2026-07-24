export function Footer() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto max-w-5xl px-6 py-8 text-xs text-slate-500">
        <p className="mb-2">
          WaveStudio is a productization layer over open-source models and DSP
          components. We do not invent models.
        </p>
        <p>
          Source is MIT. Integrated models retain their own licenses - see{' '}
          <span className="text-slate-300">LICENSES.md</span>. openWakeWord
          pre-trained models are CC BY-NC-SA 4.0 (demo-only).
        </p>
      </div>
    </footer>
  )
}
