function Logo() {
  return (
    <svg
      viewBox="0 0 512 512"
      className="h-8 w-8"
      role="img"
      aria-label="WaveStudio logo"
    >
      <rect width="512" height="512" rx="96" fill="#0b1020" />
      <g stroke="#38bdf8" strokeLinecap="round" fill="none">
        <line x1="160" y1="224" x2="160" y2="288" strokeWidth="20" />
        <line x1="208" y1="176" x2="208" y2="336" strokeWidth="20" />
        <line x1="256" y1="128" x2="256" y2="384" strokeWidth="24" />
        <line x1="304" y1="176" x2="304" y2="336" strokeWidth="20" />
        <line x1="352" y1="224" x2="352" y2="288" strokeWidth="20" />
      </g>
    </svg>
  )
}

export function Header() {
  return (
    <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
        <Logo />
        <div className="flex flex-col leading-tight">
          <span className="text-base font-semibold tracking-tight text-white">
            WaveStudio
          </span>
          <span className="text-xs text-slate-400">
            On-device wake-word pipeline studio
          </span>
        </div>
        <span className="ml-auto rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300">
          v0.0.1 · Phase 0
        </span>
      </div>
    </header>
  )
}
