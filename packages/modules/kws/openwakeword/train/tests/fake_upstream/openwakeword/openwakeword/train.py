#!/usr/bin/env python3
"""Fake upstream openwakeword train.py for adapter tests (no GPU).

Mirrors the upstream CLI (--training_config + stage flags) so the adapter's
subprocess orchestration, log streaming and bundle normalization are tested
deterministically. Lives in tests/fake_upstream/openwakeword/openwakeword/ to
reproduce the real upstream layout.
"""
import argparse
import os
import time

p = argparse.ArgumentParser()
p.add_argument("--training_config")
p.add_argument("--generate_clips", action="store_true")
p.add_argument("--augment_clips", action="store_true")
p.add_argument("--train_model", action="store_true")
a = p.parse_args()

print(
    f"fake upstream: config={a.training_config} generate={a.generate_clips} "
    f"augment={a.augment_clips} train={a.train_model}",
    flush=True,
)
time.sleep(0.01)
if a.train_model:
    import yaml

    cfg = yaml.safe_load(open(a.training_config, encoding="utf-8"))
    name = cfg["model_name"]
    os.makedirs("my_custom_model", exist_ok=True)
    with open(f"my_custom_model/{name}.onnx", "w") as f:
        f.write("fake-model")
    print("Epoch 1/1 loss=0.5", flush=True)
    print("Validation: recall 0.93, accuracy 0.95, false positives/hour 0.1", flush=True)
print("done", flush=True)
