import { Header } from './components/Header'
import { PipelineView } from './components/PipelineView'
import { Domains } from './components/Domains'
import { Footer } from './components/Footer'

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
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
            Phase 0 · foundation &amp; scaffold · in progress
          </p>
        </section>

        <PipelineView />
        <Domains />
      </main>

      <Footer />
    </div>
  )
}
