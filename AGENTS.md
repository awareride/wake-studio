# AGENTS.md

This file gives coding agents the ground rules for working in this repository.
Read it before making any changes.

## Working with a human

You are collaborating with a **real human developer**, not running unattended.
Treat every change as if a teammate will review it on Monday morning.

- Prefer small, focused, reviewable changes over large sweeps.
- Explain your reasoning and trade-offs, not just the result.
- When something is ambiguous, **ask first** instead of guessing. State your
  assumption explicitly and let the human correct it before proceeding.
- Keep the human in the loop at every non-trivial step: what you are about to
  do, what you did, and what to verify next.

## Language policy

- **All artifacts written into the repo must be in English**, regardless of the
  language used in conversation. This includes source code, comments, commit
  messages, documentation (`.md`), content collection files, and config.
- You may converse with the human in whatever language they use, but never let
  that leak into committed files.
- The only exception is files explicitly marked for another locale, e.g.
  `README.zh.md`, `getting-started.zh.md`. If a file is not clearly scoped to a
  non-English locale, write English.
- **GitHub work products must also be in English**: issue titles and bodies,
  project item names/fields/statuses, labels, pull request titles and bodies,
  and any commit messages or release notes. Chinese (or any other language)
  is allowed only in human conversation, never in anything the agent writes
  to GitHub, a commit, or a PR.

## Planning docs & GitHub work tracking

Three layers, each with its own reader and role. Do not blur them:

| Layer | Where | Reader | Role | Nature |
|---|---|---|---|---|
| **Agent guidance** | `AGENTS.md`, `CONTRIBUTING.md`, `docs/roadmap.md` (all tracked) | agent | vision, constraints, roadmap/phase history, working agreements, issue index | static (low churn) |
| **Work state** | GitHub Issues + `WakeStudio Delivery` project (org `awareride`) | human + cross-session | who/what/when/blocked | dynamic (live) |
| **Durable knowledge** | `docs/`, `DECISIONS.md`, `docs/modules/*.md` | human + agent | ADRs, architecture, module specs | versioned with code |

### Roadmap doc (`docs/roadmap.md`) — read, don't maintain state

The roadmap is **static guidance**: vision, requirements, phase history, and
pointers to issues. It is tracked on purpose (reviewable on GitHub). Rules:

- Read `docs/roadmap.md` for **static guidance** at session start (alongside
  the board). It is the fastest way to load the project's shape.
- The roadmap does **not** hold live state. Do not edit phase/status tables
  in it — state lives in GitHub.
- The only roadmap edits allowed are **static-pointer fixes** (e.g. an issue
  number that went stale) and new phase entries once a phase ships.

### GitHub Issues + Projects — the live state source

Task and planning state lives in **GitHub Issues + the `WakeStudio Delivery`
project** (org `awareride`), driven through the `gh` CLI. See
`CONTRIBUTING.md` (Issues & Projects section) for the full model.

- **Session start:** load live state with `gh project item-list 2 --owner
  awareride` (or `gh issue list`). Prefer this over reading doc/roadmap state.
- Before starting any non-trivial task, confirm the corresponding issue exists
  (create it with `gh issue create` using the task/bug template if not) and
  move it to `In progress` in the project.
- PR bodies must reference the issue (`Closes #N` / `Fixes #N`) so merge
  auto-closes it.
- On merge/close, move the issue to `Done` in the project.
- Use the repo's label set (type `epic`/`task`/`bug`/`question`/`docs`,
  priority `p0`/`p1`, scope `sdk`/`kws`/`training`/`web`/`device`/`ci/deploy`/
  `platform`/`export`/`few-shot`/`afe`).
- Questions (`question` label) close with a decision that lands as an ADR.
- **State changes go to GitHub only** — never write status back into plan
  files.

## Git & deployment boundaries

- You **may** stage and commit locally (`git add`, `git commit`) to group
  logical work.
- You **must not** run `git push`, `git push --force`, or any command that
  writes to the remote (`origin`) on your own. Pushing to remote is initiated
  by the human developer. When work is ready, tell the human and let them push.
- Never amend, rebase, or rewrite history that has already been pushed.
- The `main` branch is protected. The deploy workflow
  (`.github/workflows/deploy.yml`) is triggered manually (workflow_dispatch)
  and publishes to GitHub Pages and Cloudflare Pages. Do not push to `main`
  yourself.

## Dangerous actions require authorization

Before performing any potentially destructive operation, **stop and get
explicit authorization from the human**. This includes, but is not limited to:

- `git push`, `git push --force`, `git reset --hard`, `git rebase`, history
  rewriting, deleting branches or tags.
- Deleting or overwriting files outside the scope of the current task.
- Mass find-and-replace or refactors that touch many files at once.
- Modifying CI/deploy workflows, secrets, or permissions.
- Installing, removing, or upgrading dependencies (`npm install`, changing
  `package.json` / `package-lock.json`).
- Destructive shell commands (`rm -rf`, `chmod`, `sudo`, etc.).
- Anything that changes how the site builds or deploys.

When in doubt, ask. "I think this is safe" is not authorization.
