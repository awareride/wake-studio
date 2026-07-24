# Contributing to WaveStudio

WaveStudio is built with a human in the loop. This guide complements
[`AGENTS.md`](./AGENTS.md) (the ground rules for agents and humans alike) and
[`DECISIONS.md`](./DECISIONS.md) (the architecture decision log). Read all
three before making changes.

## Ground rules (non-negotiable)

- **Small, focused, reviewable changes** over large sweeps.
- **English only** in all committed artifacts (code, comments, docs, configs).
  Non-English files are allowed only when explicitly locale-scoped
  (e.g. `README.zh.md`).
- **Never push to `main`.** `main` is protected. Open a branch/PR instead.
- **Never run `git push`, `git push --force`, or history-rewriting commands.**
  Pushing to `origin` is always initiated by the human.
- **Dangerous actions need explicit authorization** before you run them:
  installing/removing/upgrading dependencies (`pnpm install`, editing
  `package.json`), modifying CI/deploy workflows or secrets, mass refactors,
  destructive shell commands, or anything that changes how the site builds or
  deploys. When in doubt, **ask first**.

## Project layout

```
.
├─ AGENTS.md            # ground rules for agents + humans
├─ DECISIONS.md         # ADR log
├─ LICENSES.md          # third-party license matrix + policy
├─ CONTRIBUTING.md      # this file
├─ README.md            # project overview + quick start
├─ index.html           # Vite entry
├─ vite.config.ts       # Vite + PWA + Tailwind plugin
├─ tsconfig*.json       # TS project references
├─ eslint.config.js     # flat ESLint config
├─ public/
│  ├─ model-registry.json  # lazily-fetched model catalog (ADR-011)
│  └─ icon.svg             # PWA icon source
├─ src/
│  ├─ main.tsx           # React entry
│  ├─ App.tsx            # app shell
│  ├─ index.css          # Tailwind entry
│  ├─ components/        # UI components
│  └─ data/              # typed data + registry loader
├─ e2e/                  # Playwright smoke tests
└─ .github/workflows/    # ci.yml (push/PR) + deploy.yml (manual)
```

## First-time setup

```bash
# 1. Enable pnpm via corepack (one time). Node 18+ required.
corepack enable
corepack prepare pnpm@9.15.4 --activate   # matches package.json "packageManager"

# 2. Install dependencies (requires authorization per AGENTS.md)
pnpm install

# 3. Generate raster PWA icons from public/icon.svg (one time, optional for dev)
pnpm run pwa-assets

# 4. Develop
pnpm dev
```

## Common scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Start the Vite dev server with HMR. |
| `pnpm build` | Type-check (`tsc -b`) then build the PWA to `dist/`. |
| `pnpm preview` | Serve the production build locally. |
| `pnpm lint` | Run ESLint over the project. |
| `pnpm typecheck` | Run `tsc` without emitting. |
| `pnpm test:e2e` | Run Playwright e2e tests (installs browsers on first run). |
| `pnpm pwa-assets` | Regenerate raster PWA icons from `public/icon.svg`. |

## Branching & commits

- Branch from `main` as `phase<N>-<topic>` or `feat/<topic>`.
- Commit messages: short imperative summary, then an optional body. Reference
  the plan phase and any ADR, e.g. `Phase 0: scaffold PWA shell (ADR-004)`.
- Commit logical units locally. Group related work. Do not commit generated
  artifacts (`dist/`, lockfiles are the exception - `pnpm-lock.yaml` IS tracked).

## How to add things later (forward references)

- **A new AFE stage** (Phase 1): add a typed module under `src/afe/` implementing
  the pluggable `AudioWorkletNode` + WASM core interface; register it in the
  pipeline graph; add a visualization. Keep stages bypassable.
- **A new export target** (Phase 4): add an adapter under `src/export/<target>/`
  that emits model + AFE config + `demo/` + `README.md` + `LICENSES.md`, and a
  `test/` FAR/FRR script. Respect the license gate.
- **A new decision**: append an ADR to `DECISIONS.md`; never delete old ones.

## License policy reminder

- WaveStudio source is MIT (ADR-009).
- **Never** bundle an openWakeWord pre-trained model into a commercial export -
  they are CC BY-NC-SA 4.0 (see `LICENSES.md`). The export gate enforces this.
- When in doubt about a license, stop and add it to `LICENSES.md` before
  integrating the component.
