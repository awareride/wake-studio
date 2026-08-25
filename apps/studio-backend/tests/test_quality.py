"""wake_train_kit.quality tests — quality gate + dedup + reproducible split (#209).

No network / no GPU: clips are tiny synthetic WAVs written with the stdlib
`wave` module. Covers the health report (per-label stats, silence/clipping/
sample-rate drift), exact + near-duplicate detection, in-place dedup, and the
seeded train/val/test split (no near-dup leakage, byte-reproducible).
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

import pytest

from wake_train_kit import quality as q


def make_wav(path: Path, samples: list[int], rate: int = 16000) -> Path:
    """Write a canonical 16 kHz mono s16le WAV clip."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(
            b"".join(struct.pack("<h", min(32767, max(-32768, int(s)))) for s in samples)
        )
    return path


def sine(duration: float = 1.0, freq: float = 440.0, rate: int = 16000) -> list[int]:
    return [int(8000 * math.sin(2 * math.pi * freq * i / rate)) for i in range(int(duration * rate))]


def phrase(freq: float, mod: float, duration: float = 1.0, rate: int = 16000) -> list[int]:
    """Speech-like clip: amplitude-modulated harmonic (distinct envelope + pitch)."""
    out: list[int] = []
    for i in range(int(duration * rate)):
        t = i / rate
        env = 0.6 + 0.4 * math.sin(2 * math.pi * mod * t)
        s = env * (8000 * math.sin(2 * math.pi * freq * t) + 0.4 * 8000 * math.sin(2 * math.pi * 2 * freq * t))
        out.append(int(s))
    return out


def _tree(tmp_path: Path) -> Path:
    """A small canonical audio/<label>/*.wav tree with 2 real labels + noise."""
    root = tmp_path / "audio"
    make_wav(root / "hey_studio" / "a.wav", phrase(440, 3.0))
    make_wav(root / "hey_studio" / "b.wav", phrase(880, 5.0))
    make_wav(root / "goodbye" / "x.wav", phrase(220, 2.0))
    make_wav(root / "_background_noise_" / "n1.wav", [0] * 16000)
    return root


def _manifest(labels: list[dict]) -> dict:
    return {
        "schemaVersion": 1,
        "id": "ds-t",
        "name": "test-ds",
        "version": 1,
        "kind": "generated",
        "role": "mixed",
        "audio": {"sampleRate": 16000, "channels": 1, "encoding": "pcm_s16le",
                  "clips": 4, "durationSec": 4},
        "labels": labels,
        "provenance": [{"name": "test", "license": "user-owned", "commercialUse": True}],
        "contentHash": None,
        "storage": None,
        "quality": None,
        "split": None,
        "createdAtMs": 1,
    }


# ---------------------------------------------------------------------------
# WAV probing
# ---------------------------------------------------------------------------

def test_parse_wav_probes_canonical_clip(tmp_path):
    wav = make_wav(tmp_path / "c.wav", sine())
    meta = q.parse_wav(wav.read_bytes())
    assert meta is not None
    assert meta.sample_rate == 16000
    assert meta.channels == 1
    assert meta.bits == 16
    assert meta.frames == 16000
    assert abs(meta.duration_sec - 1.0) < 1e-6
    assert not meta.silent
    assert not meta.clipping


def test_parse_wav_handles_garbage_and_non_pcm():
    assert q.parse_wav(b"not a wav at all") is None
    assert q.parse_wav(b"RIFF\x10\x00\x00\x00WAVE") is None  # no fmt chunk


def test_parse_wav_silence_and_clipping(tmp_path):
    silent = make_wav(tmp_path / "s.wav", [0] * 16000)
    clipped = make_wav(tmp_path / "c.wav", [32767] * 16000)
    assert q.parse_wav(silent.read_bytes()).silent
    assert q.parse_wav(clipped.read_bytes()).clipping


# ---------------------------------------------------------------------------
# Health report
# ---------------------------------------------------------------------------

def test_check_dataset_clean_tree_passes(tmp_path):
    root = _tree(tmp_path)
    manifest = _manifest([
        {"name": "hey_studio", "role": "positive", "source": "real", "voices": ["v1", "v2"]},
        {"name": "goodbye", "role": "unknown", "source": "synthetic"},
        {"name": "_background_noise_", "role": "noise", "source": "real"},
    ])
    report = q.check_dataset(root, manifest)
    assert report["verdict"] == "pass"
    assert report["totals"]["clips"] == 4
    assert report["labels"]["hey_studio"]["clips"] == 2
    assert report["labels"]["hey_studio"]["voices"] == 2
    assert report["warnings"] == []
    # manifest tags only carry into the manifest summary
    summary = q.quality_summary(report)
    assert summary["verdict"] == "pass"
    assert summary["warnings"] == []


def test_check_dataset_empty_label_fails(tmp_path):
    root = tmp_path / "audio"
    make_wav(root / "hey_studio" / "a.wav", sine())
    (root / "empty_label").mkdir(parents=True)
    report = q.check_dataset(root)
    assert report["verdict"] == "fail"
    assert any(w["code"] == "empty-label" for w in report["warnings"])


def test_check_dataset_silence_and_clipping_warn(tmp_path):
    root = tmp_path / "audio"
    make_wav(root / "pos" / "a.wav", sine())
    make_wav(root / "pos" / "b.wav", [0] * 16000)      # silent
    make_wav(root / "pos" / "c.wav", [32767] * 16000)  # clipped
    report = q.check_dataset(root)
    codes = {w["code"] for w in report["warnings"]}
    assert {"silence", "clipping"} <= codes
    assert report["verdict"] == "warn"


def test_check_dataset_sample_rate_drift_warns(tmp_path):
    root = tmp_path / "audio"
    make_wav(root / "pos" / "a.wav", sine())
    make_wav(root / "pos" / "off.wav", sine(), rate=8000)
    report = q.check_dataset(root)
    assert report["totals"]["nonStandardSampleRate"] == 1
    assert any(w["code"] == "sample-rate-drift" for w in report["warnings"])


def test_check_dataset_too_few_voices_and_synthetic_warn(tmp_path):
    root = tmp_path / "audio"
    make_wav(root / "hey_studio" / "a.wav", sine())
    manifest = _manifest([
        {"name": "hey_studio", "role": "positive", "source": "synthetic", "voices": ["v1"]},
    ])
    report = q.check_dataset(root, manifest)
    codes = {w["code"] for w in report["warnings"]}
    assert "too-few-voices" in codes
    assert "all-synthetic-positive" in codes


def test_check_dataset_accepts_extracted_audio_wrapper(tmp_path):
    # some tooling extracts the zip with an `audio/` wrapper dir
    outer = tmp_path / "extract"
    make_wav(outer / "audio" / "pos" / "a.wav", sine())
    report = q.check_dataset(outer)
    assert report["verdict"] == "pass"


def test_check_dataset_no_clips_raises(tmp_path):
    with pytest.raises(q.QualityError):
        q.check_dataset(tmp_path / "nothing-here")


# ---------------------------------------------------------------------------
# Exact duplicates + dedup
# ---------------------------------------------------------------------------

def test_exact_duplicate_groups(tmp_path):
    root = tmp_path / "audio"
    base = sine()
    make_wav(root / "pos" / "a.wav", base)
    make_wav(root / "pos" / "b.wav", base)             # byte-identical
    make_wav(root / "pos" / "c.wav", sine(freq=500.0))
    groups = q.exact_duplicate_groups(root)
    assert len(groups["pos"]) == 1
    assert sorted(groups["pos"][0]) == ["a.wav", "b.wav"]


def test_deduplicate_clips_removes_exact_duplicates(tmp_path):
    root = tmp_path / "audio"
    make_wav(root / "pos" / "a.wav", sine())
    make_wav(root / "pos" / "b.wav", sine())           # byte-identical
    stats = q.deduplicate_clips(root)
    assert stats["removed"] == 1
    assert (root / "pos" / "a.wav").exists()
    assert not (root / "pos" / "b.wav").exists()


# ---------------------------------------------------------------------------
# Near duplicates + reproducible split
# ---------------------------------------------------------------------------

def test_near_duplicate_clusters_group_similar_clips(tmp_path):
    root = tmp_path / "audio"
    base = sine()
    copy = list(base)
    for i in range(0, len(copy), 133):  # tiny LSB jitter: same perceptual features
        copy[i] = min(32767, copy[i] + 1)
    make_wav(root / "pos" / "a.wav", base)
    make_wav(root / "pos" / "b.wav", copy)
    make_wav(root / "pos" / "c.wav", phrase(1800, 5.0))  # clearly different
    env_a, _ = q.audio_feature(base)
    assert q.audio_similarity(env_a, q.amplitude_envelope(copy)) >= q.NEAR_DUP_SIMILARITY
    assert q.audio_similarity(env_a, q.amplitude_envelope(phrase(1800, 5.0))) < q.NEAR_DUP_SIMILARITY
    clusters = q.near_duplicate_clusters(root)
    assert len(clusters) == 1
    assert {p.name for p in clusters[0]} == {"a.wav", "b.wav"}


def test_near_duplicate_detection_cross_label_ignored(tmp_path):
    root = tmp_path / "audio"
    base = sine()
    make_wav(root / "pos" / "a.wav", base)
    make_wav(root / "pos2" / "b.wav", base)
    assert q.near_duplicate_clusters(root) == []


def test_split_records_partition_and_is_deterministic(tmp_path):
    root = tmp_path / "audio"
    for i in range(12):
        make_wav(root / "pos" / f"c{i:02d}.wav", phrase(400.0 + i * 40, 3.0 + (i % 3)))
    manifest = _manifest([{"name": "pos", "role": "positive"}])

    split_a, parts_a = q.split_dataset(root, manifest, seed=7)
    split_b, parts_b = q.split_dataset(root, manifest, seed=7)
    assert split_a["split"] == split_b["split"]  # byte-reproducible

    split_field = split_a["split"]
    assert split_field["seed"] == 7
    assert list(split_field["ratios"]) == [0.8, 0.1, 0.1]
    all_refs = sorted(split_field["train"] + split_field["val"] + split_field["test"])
    expected = sorted(
        [f"audio/pos/c{i:02d}.wav" for i in range(12)]
    )
    assert all_refs == expected  # every clip in exactly one partition
    assert len(parts_a["train"]) == len(split_field["train"])

    # different seed -> different partition (clips are distinct singles)
    split_c, _ = q.split_dataset(root, manifest, seed=8)
    assert split_c["split"]["train"] != split_a["split"]["train"]


def test_split_keeps_near_duplicates_in_one_partition(tmp_path):
    root = tmp_path / "audio"
    base = sine()
    dup = list(base)
    for i in range(0, len(dup), 97):
        dup[i] = min(32767, dup[i] + 1)
    # 6 pairs of near-duplicates + 6 unique clips
    for i in range(6):
        make_wav(root / "pos" / f"p{i}.wav", base)          # duplicates of base
    for i in range(6):
        make_wav(root / "pos" / f"u{i}.wav", sine(freq=300.0 + i * 120))
    make_wav(root / "pos" / "dup.wav", dup)                 # near-dup of base

    manifest = _manifest([{"name": "pos", "role": "positive"}])
    split, _ = q.split_dataset(root, manifest, seed=3)
    partitions = {k: set(v) for k, v in split["split"].items() if k in ("train", "val", "test")}
    same = {p for p in partitions if "audio/pos/p0.wav" in partitions[p]}
    assert same == {p for p in partitions if "audio/pos/dup.wav" in partitions[p]}


def test_split_manifest_never_mutates_input(tmp_path):
    root = tmp_path / "audio"
    make_wav(root / "pos" / "a.wav", sine())
    manifest = _manifest([{"name": "pos", "role": "positive"}])
    before = dict(manifest)
    q.split_dataset(root, manifest, seed=1)
    assert manifest == before