# Module Doc Template

> How to use this template: copy it to `docs/modules/<name>.md` at the start of the
> phase that implements the module (see plan §11). Fill it in *before* writing code
> (docs-first), then keep it in sync with the code in the same change. Delete any
> section heading that genuinely does not apply, but prefer to keep the structure
> consistent across modules. Replace every `<...>` placeholder.

---

# <Module Name> - Module Specification

- **Status:** Draft | Accepted | Superseded
- **Owner:** <team / person>
- **Plan phase:** <e.g. Phase 1>
- **Related ADRs:** <e.g. ADR-001, ADR-003>
- **Depends on (modules):** <e.g. AFE, KWS, none>
- **Last updated:** <YYYY-MM-DD>

## 1. Purpose

One or two paragraphs: what this module does, who uses it, and why it exists in
WakeStudio. State the single responsibility clearly.

## 2. Scope & boundaries

- **In scope:** what this module is responsible for.
- **Out of scope:** what is explicitly handled elsewhere (name the owning module).
- **Public surface:** the high-level capabilities/APIs this module exposes to the
  rest of the app.

## 3. Dependencies

- **Upstream (consumes from):** modules/services whose output this module uses.
- **Downstream (provides to):** modules/services that consume this module's output.
- **External libraries / models:** third-party packages or model weights, with
  license and source (cross-link `LICENSES.md`).

## 4. Public API & types

The contract other code relies on. Show the TypeScript signatures / message shapes.
Example:

```ts
export interface StageNode {
  readonly id: string;
  readonly kind: 'aec' | 'bss' | 'ns';
  setBypassed(bypassed: boolean): void;
  process(frame: Float32Array): Float32Array;
}
```

List the exported functions/classes/types and their contracts (inputs, outputs,
error cases). This is the part a docs-first review must approve before implementation.

## 5. Data flow / sequence

Describe how data moves through this module, ideally with a small diagram or
step-by-step list. Cover the happy path and note where decisions branch.

## 6. Configuration & constants

All tunable parameters (thresholds, frame sizes, latency budgets, sample rates),
their defaults, valid ranges, and where they are set. Example:

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `sampleRate` | 16000 | fixed | 16 kHz mono throughout. |
| `latencyBudgetMs` | 150 | - | Target end-to-end capture -> display. |

## 7. Error model & failure modes

- How the module reports errors (thrown exceptions, result types, events).
- Specific failure modes and their handling/recovery (e.g. mic permission denied,
  WASM load failure, model fetch error, provider API error).
- What is *not* recovered from (fatal).

## 8. Observability

- What metrics/logs/visualizations the module emits for debugging and the in-app UI.
- How a developer inspects module state (dev panel, console, recorded replay).

## 9. Testing strategy

- Unit tests (pure logic), integration tests (real audio/runtime), and e2e coverage.
- Fixtures: representative audio clips / model inputs and expected outputs.
- Targets: e.g. "false-alarm rate < 1/hour on 5 min ambient speech" with how it is
  measured. Note any manual/on-hardware validation steps.

## 10. Security & privacy

- What sensitive data the module touches (mic audio, user credentials, prototypes).
- Where data is stored (memory, IndexedDB, remote) and retention.
- Credential/secret handling rules (e.g. cloud-provider credentials are client-side
  only, never logged/exported).

## 11. Open questions

Unresolved design questions for the human, marked `[Q]`. Each should eventually
become an ADR in `DECISIONS.md` once resolved.

## 12. References

- Plan sections / phases this module implements.
- ADRs that constrain it.
- Upstream project docs / papers.
- Related module docs (`docs/modules/*.md`).

## 13. Change log

| Date | Change | Author |
|---|---|---|
| <YYYY-MM-DD> | Initial draft (docs-first). | <who> |
