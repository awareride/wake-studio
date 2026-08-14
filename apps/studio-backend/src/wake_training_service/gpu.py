"""GPU info for /health - capability labels (ADR-013/036)."""

from __future__ import annotations

from typing import Any


def gpu_info() -> dict[str, Any]:
    """Best-effort GPU/CUDA detection; never raises."""
    info: dict[str, Any] = {"cuda": False, "device": None, "vram_bytes": None, "label": None}
    try:
        import torch  # type: ignore
        info["torch"] = torch.__version__
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            info["cuda"] = True
            info["device"] = torch.cuda.get_device_name(0)
            info["vram_bytes"] = int(props.total_memory)
            info["label"] = f"{info['device']} ({info['vram_bytes'] // (1024 ** 2)} MiB)"
    except Exception:
        pass
    return info
