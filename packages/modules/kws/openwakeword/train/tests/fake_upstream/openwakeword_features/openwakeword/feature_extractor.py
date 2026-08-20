"""Fake upstream mel feature extractor (no numpy / no openwakeword)."""


class _FakeFeatures:
    """Duck-types a numpy float32 2-D array for the minimal .npy writer."""

    def __init__(self, frames: int = 98, mels: int = 40) -> None:
        self.shape = (frames, mels)
        self.dtype = "float32"

    def tobytes(self) -> bytes:
        return b"fake-mel-features-" * 16


def get_mel_spectrogram(audio_path, model_sampling_rate: int = 16000):
    """Mirror upstream's signature; return deterministic fake features."""
    return _FakeFeatures()
