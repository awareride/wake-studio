# Contributing to WakeStudio

WakeStudio is built with a human in the loop. This guide complements
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
├─ docs/                # architecture + per-module specs (docs-first)
│  ├─ architecture.md   # durable high-level architecture (monorepo, §3.1)
│  ├─ module-spec.md    # declarative module spec + panel generator (ADR-025)
│  ├─ build-artifacts.md# CI-built artifact SOP (ADR-027)
│  ├─ module-template.md# template for module specs
│  └─ modules/          # per-module specs, written just-in-time (plan §11)
├─ apps/
│  ├─ web/              # PWA (React + Vite); public/ = model-registry.json, icons
│  ├─ local-service/    # Node API service (Self-hosted training backend, ADR-005)
│  └─ cli/              # ops CLI (fetch, health, train trigger) - optional
├─ packages/
│  ├─ contracts/        # shared types + schemas (module-spec, kws, afe, train)
│  ├─ module-kit/       # panel generator / playground router / spec validator
│  ├─ test-kit/         # L2 wasm runner (ADR-026)
│  ├─ modules/          # functional modules: packages/modules/<category>/<name>/
│  │                     #   core/ web/ node/ train/ device/ spec/ tests/
│  └─ sdk/              # device-side SDK (ADR-021)
├─ device/              # device world root (C/C++, CMake build tree)
├─ scripts/             # root-level ops scripts (fetch-*.mjs per ADR-027)
├─ e2e/                 # Playwright L3 tests (web app)
└─ .github/workflows/   # ci.yml + build-<artifact>.yml + train-<module>.yml + deploy.yml
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
| `pnpm test:unit` | Run the L1 unit tests (vitest). |
| `pnpm test:e2e` | Run Playwright e2e (L3) tests (auto-installs the Chromium browser if needed). |
| `pnpm fetch:<artifact>` | Sync a CI-built artifact locally (ADR-027, `docs/build-artifacts.md`). |
| `pnpm fetch:all` | Sync every CI-built artifact. |
| `pnpm pwa-assets` | Regenerate raster PWA icons from `public/icon.svg`. |

## Testing layers (ADR-026)

- **L1 unit (vitest, fast):** pure logic - DSP (in `@wake-studio/dsp`, ADR-032),
  matchers, state machines. No
  runtime/model dependencies. Runs on every PR.
- **L2 wasm runtime (Node, fast):** a module's wasm/onnx artifact is loaded in
  a Node process and exercised (boot + one inference pass). Same artifact the
  browser uses, no browser, no 55 MB fetch. Runs on every PR.
- **L3 browser e2e (Playwright, slow):** full UI flows; the authority for
  browser-only semantics (threads, SharedArrayBuffer). Runs before merge to
  `main`, at a lower cadence than L1/L2.

Run `pnpm test:unit` before pushing; the CI runs L1+L2 on every PR.

## Branching & commits

- Branch from `main` as `phase<N>-<topic>` or `feat/<topic>`.
- Commit messages: short imperative summary, then an optional body. Reference
  the plan phase and any ADR, e.g. `Phase 0: scaffold PWA shell (ADR-004)`.
- Commit logical units locally. Group related work. Do not commit generated
  artifacts (`dist/`, lockfiles are the exception - `pnpm-lock.yaml` IS tracked).

## Issues & Projects (work tracking)

Task state lives in GitHub Issues + the **WakeStudio Delivery** project
(org-level, `awareride`), not in plan documents. Docs keep the durable
knowledge (ADRs, module specs); issues keep the work state.

- **Every change starts from an issue.** Before starting a task, confirm the
  issue exists (create it if not, using the task/bug templates) and move it to
  `In progress` in the project.
- **Every PR must reference an issue.** Put `Closes #N` / `Fixes #N` in the PR
  description so merge auto-closes the issue. A PR without an issue link is
  incomplete.
- **Labels** carry type + priority + scope: `epic`, `task`, `bug`, `question`,
  `docs`, `p0`, `p1`, and the scope labels (`sdk`, `kws`, `training`, `web`,
  `device`, `ci/deploy`, `platform`, `export`, `few-shot`, `afe`).
- **Epics** group phase-sized work; their tasks are GitHub sub-issues.
- **Questions** (`question` label) close with a decision that lands as an ADR
  in `DECISIONS.md`.
- On merge/close, move the issue to `Done` in the project (or let project
  automation do it).
- Project fields: `Phase` (P0–P7, v1.x), `Priority` (P0/P1/P2), `Module`,
  `Estimate` (S/M/L), `Status` (Todo / In progress / Done).

Agent (pi) workflows should drive this via `gh`: `gh issue create`,
`gh project item-add 2 --owner awareride --url <issue>`, `gh project item-edit`,
and `gh issue close` on merge.

## Documentation-first (docs-first)

WakeStudio follows a **documentation-first** workflow (see `docs/roadmap.md`):

- **Durable design lives in `docs/`.** The high-level architecture is in
  `docs/architecture.md`; the ADR log is `DECISIONS.md`; the license matrix is
  `LICENSES.md`; the phased roadmap (vision, phases, model selection, target
  matrix) is `docs/roadmap.md`. Promote durable design there — never into
  untracked notes.
- **Module specs are written just-in-time, before code.** At the start of each
  phase (Phase 1+), copy `docs/module-template.md` to `docs/modules/<name>.md`
  and fill in the contract (purpose, scope, public API/types, data flow,
  configuration, error model, testing). Get that reviewed *before* implementing
  the module.
- **Modules follow the module platform (ADR-025).** Each functional area is a
  self-contained module with a `module.spec.json` (see
  `docs/module-spec.md`): spec-driven auto-generated panel (never hand-coded),
  L1/L2/L3 tests (ADR-026), a playground route, and multi-target deliverables
  (web / local / cloud / device) as applicable.
- **Docs and code ship together.** A module doc is a living document: update it
  in the **same change** as the code it describes. A change that touches a
  module's contract without updating its doc is incomplete; reviewers should
  reject drift.
- **Decisions become ADRs.** Anything resolved in a module's "Open questions"
  becomes an ADR in `DECISIONS.md`; never delete historical ADRs - supersede them.

| Phase | Module doc to write first |
|---|---|
| 1 | `docs/modules/afe.md` |
| 2 | `docs/modules/kws.md` |
| 3 | `docs/modules/few-shot.md` |
| 4 | `docs/modules/export.md` |
| 5 | `docs/modules/training.md` |

## How to add things later (forward references)

- **A new AFE stage implementation** (ADR-029): add a module under
  `packages/modules/afe/<stage>/` implementing the `AFEStage` interface
  (contracts); register it in the AFE graph's orchestration; add a playground.
  The graph is not edited when adding a stage implementation (decoupling rule).
- **A new KWS backend** (ADR-030): add a driver module under
  `packages/modules/kws/<backend>/` that registers itself via
  `registerKwsBackend` (or `mainThreadFactory`); the engine is not edited.
- **A new export target** (Phase 4): add an SDK adapter under `device/` (or the
  target's export module) that emits model + AFE config + `demo/` + `README.md`
  + `LICENSES.md`, and a `test/` FAR/FRR script. Respect the license gate.
- **A new decision**: append an ADR to `DECISIONS.md`; never delete old ones.

## License policy reminder

- WakeStudio source is MIT (ADR-009).
- **Never** bundle an openWakeWord pre-trained model into a commercial export -
  they are CC BY-NC-SA 4.0 (see `LICENSES.md`). The export gate enforces this.
- When in doubt about a license, stop and add it to `LICENSES.md` before
  integrating the component.
