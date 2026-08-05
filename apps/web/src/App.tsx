import { useRef, useState } from 'react'
import type { AFEPipeline } from './afe'
import { Header } from './components/Header'
import { PipelineView } from './components/PipelineView'
import { AFEPanel } from './components/AFEPanel'
import { KWSPanel } from './components/KWSPanel'
import { TrainingPanel } from './components/TrainingPanel'
import { FewShotPanel } from './components/FewShotPanel'
import { Domains } from './components/Domains'
import { Footer } from './components/Footer'
import { RnnoisePlayground } from '@wake-studio/module-rnnoise/web'

export default function App() {
  // Shared AFE pipeline ref + running state, passed to both AFEPanel and KWSPanel
  // so KWS can subscribe to the AFE output stream.
  const afeRef = useRef<AFEPipeline | null>(null)
  const [afeRunning, setAfeRunning] = useState(false)
  const [route, setRoute] = useState<'main' | 'playground-rnnoise'>('main')

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {route === 'playground-rnnoise' ? (
          <>
            <button
              onClick={() => setRoute('main')}
              className="mt-6 ml-6 rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-400 hover:bg-white/5"
            >
              ← Back to console
            </button>
            <RnnoisePlayground />
          </>
        ) : (
          <>
            {/* Hero */}
            <section className="mx-auto max-w-5xl px-6 pt-16 pb-4 text-center">
              <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
                From wake-word idea to deployable{' '}
                <span className="bg-gradient-to-r from-brand-300 to-brand-500 bg-clip-text text-transparent">
                  KWS bundle
                </span>
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400">
                A browser-first studio for the full far-field voice pipeline - no
                toolchain, runtime, or Python to install. Visualize every stage,
                enroll a custom wake word with a few samples, and export a
                ready-to-build package for your target chip.
              </p>
              <p className="mt-4 text-xs uppercase tracking-widest text-amber-300/80">
                Phase 1-3 · AFE + KWS + Few-Shot enrollment · in progress
              </p>
              <button
                onClick={() => setRoute('playground-rnnoise')}
                className="mt-6 rounded-lg bg-brand-500/10 px-4 py-2 text-sm font-medium text-brand-300 hover:bg-brand-500/20"
              >
                Try the RNNoise module playground
              </button>
            </section>

            <AFEPanel afeRef={afeRef} onRunningChange={setAfeRunning} />
            <KWSPanel afePipeline={afeRef.current} afeRunning={afeRunning} />
            <TrainingPanel />
            <FewShotPanel afePipeline={afeRef.current} afeRunning={afeRunning} />
            <PipelineView />
            <Domains />
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}
