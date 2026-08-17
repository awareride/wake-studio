# third_party - vendored upstream code

Vendored upstream projects that are **dead or archived** upstream, per
ADR-037 (Tier 3 of the integration ladder: pin -> patch -> vendor -> fork).
The upstream repo will never merge fixes, so WakeStudio owns compatibility
on the record instead of pointing at a moving (or frozen) remote.

## Rules (ADR-037 Tier 3)

- The **first commit** of a vendored tree is a **pristine import**: a
  byte-identical copy of the upstream subtree at a pinned SHA, with the
  upstream URL, path, SHA, and license recorded in the commit message.
- All changes land as **separate commits on top** of the pristine import -
  hardening only (dependency pins, modern-Python/runtime compatibility).
- Vendored code is **never linted, reformatted, or refactored**. Keep diffs
  minimal and explain each one in its commit message.
- A `LICENSE` file sits next to the vendored code even when the upstream
  subtree shipped none (the license then comes from the upstream monorepo
  root at the pinned SHA - see the import commit for provenance).
- Repo test runs **never collect** vendored suites: the root `pytest.ini`
  ignores this directory (`--ignore=third_party`).

## Contents

| Directory | Upstream | Imported at | License | Reason |
|---|---|---|---|---|
| `kws_streaming/` | `google-research/google-research` subtree `kws_streaming` | `cf61877d4c0021ff40ec3ecc0334aaa3937a1fcb` (2026-07-22, last commit touching the subtree) | Apache-2.0 | Archived upstream (project-level ARCHIVED); consumed unmodified by the kws-streaming train adapter (ADR-031; #156) |

Import details live in each pristine-import commit message; the policy
itself is ADR-037 in `DECISIONS.md`.
