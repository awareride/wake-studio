# BSS module — device target

Passthrough stage for v1 (ADR-016). The pipeline order AEC → BSS → NS holds
(ADR-001); a vendor BSS / 2-mic approximation lands in this slot in a later
phase without touching the graph or the SDK core.
