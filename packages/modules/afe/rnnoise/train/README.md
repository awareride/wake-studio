# RNNoise module - train target (ADR-028, uv-managed Python).

RNNoise is a frozen published model (xiph/rnnoise); its weights are NOT trained
in WakeStudio (ADR-002: we integrate, we do not invent models). This directory
exists to (a) satisfy the module platform's train contract and (b) document
that a custom-trained replacement (e.g. fine-tuned on target-domain noise) is a
Phase 5 concern.

Run with uv (ADR-028):

    uv run --project train python train.py --help

Outputs (spec/module.spec.json "train.outputs"):
    out/metrics.json   - training run metadata (always produced)
    out/rnnoise.onnx   - produced only when a real fine-tune is added
