#!/usr/bin/env python3
"""
Export a PLiX Few-Shot encoder to ONNX for WakeStudio's browser inference.

Source of truth: the `plixkws` PyPI package (FewshotML/plix). The encoder
trunk is `Backbone.encoder` (torchvision/timm CNN) followed by a global
average pool, exactly as in `plixkws/backbone.py::Backbone.forward`:

    x = log(MelSpectrogram(16000, f_min=60, f_max=7800,
                            n_mels=64, win_length=400, hop_length=160,
                            n_fft=1024)(audio) + 1e-6)
    x = encoder(x)                 # base: tf_efficientnetv2_m (in_chans=1,
                                   #       num_classes=0, global_pool='')
                                   # small: tinynet_e (same kwargs)
    x = x.mean(dim=(2, 3))        # global average pool -> 1280-d (base)
    x = x.squeeze(-1)

This script exports that trunk + GAP as a standalone ONNX graph whose
input is a **1 x 1 x 64 x 100** log-Mel spectrogram (the same front-end
`src/kws/backends/plixkws-embed.ts` builds in the browser) and whose
output is the **1280-d** embedding.

The published weights are PyTorch `.pt` files (Dropbox) fetched by
`plixkws.model.load(encoder_name, language)`. We reuse `plixkws.model.load`
to obtain the trained `ProtoNet`, unwrap its `backbone` (a `Backbone`
module), and trace just the encoder trunk.

Usage:
    pip install "plixkws"   # pulls torch, torchaudio, timm
    python packages/modules/kws/plix/scripts/export-plixkws-onnx.py \
        --encoder base --language en \
        --out packages/modules/kws/plix/assets/plixkws-base.onnx

Note: module `assets/` is gitignored (ADR-011); the exported `.onnx` is never
committed. The browser app loads it from `/modules/kws/plix/assets/<name>.onnx`
(ADR-025).
"""

import argparse
import json
import os

import torch


def build_encoder(
    encoder_name: str,
    checkpoint_path: str,
    device: str = "cpu",
    config_override: str | None = None,
):
    """Load the PLiX backbone trunk (encoder + GAP) from a .pt checkpoint.

    Replicates `plixkws.model.load` (downloads config.json + .pt via wget if
    missing) but returns only the embedder we need, in eval mode.
    """
    import json

    import wget

    from plixkws import backbone as bk
    from plixkws import model as plix_model

    models_dir = os.path.join(os.path.dirname(checkpoint_path) or ".", "models")
    os.makedirs(models_dir, exist_ok=True)

    config_path = os.path.join(models_dir, "config.json")
    if config_override:
        # Use a pre-downloaded config manifest (e.g. the one fetched by the
        # CI workflow into packages/modules/kws/plix/assets/plixkws-config.json) instead of
        # re-fetching from Dropbox.
        import shutil

        os.makedirs(models_dir, exist_ok=True)
        shutil.copyfile(config_override, config_path)
    if not os.path.exists(config_path):
        wget.download(
            "https://www.dropbox.com/s/ipmytoirguvzg2u/config.json?dl=1",
            out=config_path,
        )
    with open(config_path) as f:
        config = json.load(f)

    if not os.path.exists(checkpoint_path):
        url = config["urls"][f"{encoder_name}_{language_for_url(encoder_name)}"]
        wget.download(url, out=checkpoint_path)

    # ProtoNet(Backbone(...)); we only need backbone.forward's embedder part.
    proto = plix_model.load(
        encoder_name=encoder_name,
        language=language_for_url(encoder_name),
        models_dir=models_dir,
        device=device,
    )
    backbone = proto.backbone  # plixkws.backbone.Backbone
    backbone.eval()
    backbone.to(device)
    return backbone


def language_for_url(encoder_name: str) -> str:
    # `base` supports en/multi; `small` supports many languages. Default "en"
    # works for both model families; override with --language if needed.
    return "en" if encoder_name == "base" else "en"


class EncoderTrunk(torch.nn.Module):
    """Wrap the PLiX Backbone so the exported graph is (mel -> embedding)."""

    def __init__(self, backbone: torch.nn.Module):
        super().__init__()
        self.backbone = backbone

    def forward(self, mel: torch.Tensor) -> torch.Tensor:
        # mirroring Backbone.forward after the melspectrogram step:
        #   x = log(mel + 1e-6); x = encoder(x); x = mean(2,3)
        # After mean(dim=(2,3)) the tensor is already [B, 1280] (2-D), so no
        # squeeze is needed (a squeeze(-1) on a size-1280 dim is a no-op and
        # triggers an exporter warning).
        x = torch.log(mel + 1e-6)
        x = self.backbone.encoder(x)
        x = x.mean(dim=(2, 3))
        return x


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--encoder", choices=["base", "small"], default="base",
        help="PLiX encoder variant (base=EfficientNet-v2-M, small=TinyNet-E).",
    )
    parser.add_argument(
        "--language", default=None,
        help="Language tag for the .pt weights (default: en).",
    )
    parser.add_argument(
        "--checkpoint", default=None,
        help="Path to a local <encoder>_<lang>_model.pt. If omitted, "
             "plixkws.model.load downloads it from Dropbox.",
    )
    parser.add_argument(
        "--out", default="packages/modules/kws/plix/assets/plixkws-base.onnx",
        help="Output ONNX path.",
    )
    parser.add_argument(
        "--hf-dir", default=None,
        help="Also write a Hugging Face-style model directory for the "
             "'transformers' runtime: <hf-dir>/config.json and "
             "<hf-dir>/onnx/model.onnx. If omitted, only --out is written.",
    )
    parser.add_argument(
        "--config", default=None,
        help="Path to a pre-downloaded PLiX config.json manifest (overrides "
             "the Dropbox fetch). Used by the CI workflow, which stages "
             "packages/modules/kws/plix/assets/plixkws-config.json before export.",
    )
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    language = args.language or language_for_url(args.encoder)
    checkpoint = args.checkpoint or os.path.join(
        "models", f"{args.encoder}_{language}_model.pt"
    )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    backbone = build_encoder(
        args.encoder, checkpoint, device, config_override=args.config
    )
    trunk = EncoderTrunk(backbone).to(device).eval()

    # Dummy input: 1 x 1 x 64 x 100 log-Mel spectrogram.
    dummy = torch.randn(1, 1, 64, 100, device=device)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    # Use the modern torch.export-based ONNX exporter (torch >= 2.9 default).
    # It requires the `onnx` and `onnxscript` packages, which the CI workflow
    # installs. The dummy input is a concrete 1x1x64x100 tensor, so the export
    # is exact.
    #
    # Opset must be >= 18: the modern exporter only has implementations for
    # opset 18+, and exporting at 17 then down-converting fails on some ops
    # (e.g. Pad). The browser onnxruntime-web supports opset 18.
    # `dynamic_axes` is intentionally omitted: with dynamo=True it is not
    # recommended and can raise; the browser always runs a single clip
    # (batch=1), so a fixed batch is fine.
    torch.onnx.export(
        trunk,
        dummy,
        args.out,
        input_names=["input"],
        output_names=["embeddings"],
        opset_version=args.opset,
    )
    print(f"Exported {args.encoder}/{language} encoder -> {args.out}")

    if args.hf_dir:
        # HF Transformers layout for the 'transformers' runtime (local mode):
        #   <hf-dir>/config.json
        #   <hf-dir>/onnx/model.onnx   (copy of --out)
        import shutil

        os.makedirs(os.path.join(args.hf_dir, "onnx"), exist_ok=True)
        shutil.copyfile(
            args.out, os.path.join(args.hf_dir, "onnx", "model.onnx")
        )
        config = {
            "_name_or_path": os.path.basename(args.hf_dir),
            "architectures": ["PlixBackbone"],
            "model_type": "plixkws",
            "encoder": args.encoder,
            "language": language,
            "num_channels": 1,
            "num_mels": 64,
            "num_frames": 100,
        }
        with open(os.path.join(args.hf_dir, "config.json"), "w") as f:
            json.dump(config, f, indent=2)
        print(
            f"Wrote HF-style model dir -> {args.hf_dir} "
            f"(config.json + onnx/model.onnx)"
        )


if __name__ == "__main__":
    main()
