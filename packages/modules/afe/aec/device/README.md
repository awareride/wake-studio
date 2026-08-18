# AEC module — device target

Passthrough stage for v1 (ADR-016). The pipeline order AEC → BSS → NS holds
(ADR-001); a vendor AEC (WebRTC audio_processing / SpeexDSP) lands in this
slot in a later phase without touching the graph or the SDK core.
