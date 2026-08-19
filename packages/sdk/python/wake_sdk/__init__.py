"""wake_sdk — Python binding for the WakeStudio device-side SDK (ADR-021 §3).

Pure ctypes over the C ABI (no binding compiler). Loads libwake_sdk
(shared, host build) and drives the same pipeline the CLI demo and the
browser use: AFE graph → KWS backend → detection loop.

Usage:
    import wake_sdk
    sdk = wake_sdk.SDK()            # creates + composes (host root)
    pipe = sdk.pipeline("rms", cfg) # cfg: dict of wake_kws_config fields
    for frame in frames16k:         # 160 int16 samples per frame
        sample, ev = pipe.process(frame, t_ms)
        if ev: print("TRIGGER", ev)
"""

from __future__ import annotations

import ctypes
import os
from typing import Any, Optional

__all__ = ["SDK", "Pipeline", "ScoreSample", "TriggerEvent", "Capabilities", "load_library", "find_library"]

_LIBRARY_CANDIDATES = [
    os.environ.get("WAKE_SDK_LIB", ""),
    "build/libwake_sdk.so",
    "build/libwake_sdk.dylib",
    "device/build/libwake_sdk.so",
    "device/build/libwake_sdk.dylib",
    "libwake_sdk.so",
    "libwake_sdk.dylib",
]


def find_library() -> Optional[str]:
    for cand in _LIBRARY_CANDIDATES:
        if cand and os.path.isfile(cand):
            return cand
    return None


class Capabilities(ctypes.Structure):
    _fields_ = [
        ("backend_count", ctypes.c_uint),
        ("backend_ids", ctypes.POINTER(ctypes.c_char_p)),
        ("have_vad", ctypes.c_int),
        ("have_threads", ctypes.c_int),
        ("have_float_dsp", ctypes.c_int),
        ("heap_budget_kb", ctypes.c_uint),
        ("sample_rate_hz", ctypes.c_uint),
    ]


class SDKConfig(ctypes.Structure):
    _fields_ = [
        ("max_frame_buffer", ctypes.c_uint),
        ("vad_gate_enabled", ctypes.c_int),
    ]


class KWSConfig(ctypes.Structure):
    _fields_ = [
        ("threshold", ctypes.c_float),
        ("min_duration_ms", ctypes.c_uint),
        ("smoothing_window_frames", ctypes.c_uint),
        ("vad_gate_enabled", ctypes.c_int),
        ("vad_threshold", ctypes.c_float),
        ("cooldown_ms", ctypes.c_uint),
    ]

    @staticmethod
    def defaults() -> "KWSConfig":
        return KWSConfig(0.5, 300, 5, 1, 0.3, 2000)


class ModelBundle(ctypes.Structure):
    _fields_ = [("model_dir", ctypes.c_char_p)]


class ScoreSample(ctypes.Structure):
    _fields_ = [
        ("captured_at_ms", ctypes.c_double),
        ("raw_score", ctypes.c_float),
        ("smoothed_score", ctypes.c_float),
        ("triggered", ctypes.c_int),
        ("vad_probability", ctypes.c_float),
    ]


class TriggerEvent(ctypes.Structure):
    _fields_ = [
        ("triggered_at_ms", ctypes.c_double),
        ("peak_score", ctypes.c_float),
        ("word", ctypes.c_char_p),
    ]


def load_library(path: Optional[str] = None) -> ctypes.CDLL:
    path = path or find_library()
    if path is None:
        raise RuntimeError(
            "libwake_sdk not found; build it with "
            "'cmake -S device -B build && cmake --build build' and set "
            "WAKE_SDK_LIB or run from the repo root"
        )
    lib = ctypes.CDLL(path)

    # --- prototypes (C ABI, see device/core/include/wake/*.h) ---------------
    lib.wake_sdk_version.restype = ctypes.c_char_p
    lib.wake_sdk_create.restype = ctypes.c_void_p
    lib.wake_sdk_create.argtypes = [ctypes.POINTER(SDKConfig)]
    lib.wake_sdk_destroy.argtypes = [ctypes.c_void_p]
    lib.wake_sdk_compose.argtypes = [ctypes.c_void_p]
    lib.wake_sdk_capabilities.restype = Capabilities
    lib.wake_sdk_capabilities.argtypes = [ctypes.c_void_p]
    lib.wake_pipeline_create.restype = ctypes.c_void_p
    lib.wake_pipeline_create.argtypes = [
        ctypes.c_void_p, ctypes.c_char_p,
        ctypes.POINTER(KWSConfig), ctypes.POINTER(ModelBundle),
    ]
    lib.wake_pipeline_destroy.argtypes = [ctypes.c_void_p]
    lib.wake_pipeline_process.restype = ctypes.c_int
    lib.wake_pipeline_process.argtypes = [
        ctypes.c_void_p, ctypes.POINTER(ctypes.c_int16), ctypes.c_size_t,
        ctypes.c_double, ctypes.POINTER(ScoreSample),
        ctypes.POINTER(TriggerEvent),
    ]
    lib.wake_pipeline_reset.argtypes = [ctypes.c_void_p]
    return lib


class SDK:
    """SDK instance: creates + composes the host composition root."""

    def __init__(self, lib: Optional[ctypes.CDLL] = None):
        self._lib = lib or load_library()
        self._handle = self._lib.wake_sdk_create(None)
        if not self._handle:
            raise RuntimeError("wake_sdk_create failed")
        self._lib.wake_sdk_compose(self._handle)

    @property
    def version(self) -> str:
        return self._lib.wake_sdk_version().decode()

    @property
    def capabilities(self) -> Capabilities:
        return self._lib.wake_sdk_capabilities(self._handle)

    def pipeline(self, backend_id: str = "rms",
                 cfg: Optional[dict[str, Any]] = None,
                 model_dir: Optional[str] = None) -> "Pipeline":
        kws = KWSConfig.defaults()
        if cfg:
            for k, v in cfg.items():
                setattr(kws, k, v)
        bundle = ModelBundle()
        bundle.model_dir = model_dir.encode() if model_dir else None
        handle = self._lib.wake_pipeline_create(
            self._handle, backend_id.encode(), ctypes.byref(kws),
            ctypes.byref(bundle),
        )
        if not handle:
            raise RuntimeError(f"pipeline create failed for backend '{backend_id}'")
        return Pipeline(self._lib, handle)

    def close(self) -> None:
        if self._lib and self._handle:
            self._lib.wake_sdk_destroy(self._handle)
            self._handle = None

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass


class Pipeline:
    """One detection pipeline (AFE graph → backend → loop)."""

    FRAME = 160  # 10 ms @ 16 kHz

    def __init__(self, lib: ctypes.CDLL, handle: int):
        self._lib = lib
        self._handle = handle

    def process(self, frame: "list[int]", t_ms: float
                ) -> tuple[ScoreSample, Optional[TriggerEvent]]:
        arr = (ctypes.c_int16 * len(frame))(*frame)
        out = ScoreSample()
        ev = TriggerEvent()
        self._lib.wake_pipeline_process(self._handle, arr, len(frame), t_ms,
                                        ctypes.byref(out), ctypes.byref(ev))
        return out, ev if out.triggered else None

    def reset(self) -> None:
        self._lib.wake_pipeline_reset(self._handle)

    def close(self) -> None:
        if self._lib and self._handle:
            self._lib.wake_pipeline_destroy(self._handle)
            self._handle = None

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass
