"""Fake openwakeword package for the datasets-path adapter tests (#206).

Provides `openwakeword.feature_extractor.get_mel_spectrogram` so the
openwakeword materializer's default extractor resolves WITHOUT installing
openwakeword/numpy. The returned object duck-types a numpy float32 array
(shape / dtype / tobytes) — the materializer's minimal .npy writer consumes it.
"""
