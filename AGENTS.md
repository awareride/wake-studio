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

## Issue & project discipline

Task and planning state lives in **GitHub Issues + the `WakeStudio Delivery`
project** (org `awareride`), driven through the `gh` CLI. Docs keep the
durable knowledge (ADRs, module specs, architecture); issues keep the work
state. See `CONTRIBUTING.md` (Issues & Projects section) for the full model.

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
