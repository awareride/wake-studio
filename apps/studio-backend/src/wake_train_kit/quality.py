"""wake_train_kit.quality — dataset quality gate + reproducibility (ADR-044 §9, #209).

Implements the v1 priorities from `docs/modules/data-sources.md` §9:

1. **Quality gate** — `check_dataset()` produces a health report: per-label
   clip counts, duration distribution, silence/empty clips, exact duplicates
   (sha256), near duplicates (perceptual fingerprint), clipping, sample-rate
   drift, label imbalance, voice counts + real-vs-synthetic (from the
   manifest). Every finding is a structured warning (code + severity) and the
   overall verdict is ``pass | warn | fail`` so trainers and the Datasets
   console can act on it. The ``check-dataset`` job records the verdict +
   warnings into the dataset manifest as ``quality`` (a silent content
   change bumps the dataset ``version`` — reproducibility rule).
2. **Synthetic-to-real gap** — per-label voice count + ``source`` come from
   the manifest; warnings fire on too-few voices and on 100%-synthetic
   wake-word datasets (TTS overfit risk at inference).
3. **Dedup + reproducible splits** — exact duplicates are removable when
   mixing datasets (``deduplicate_clips``); near-duplicate clips are
   clustered (perceptual fingerprint, union-find) so a seeded
   ``split_dataset`` assigns an entire cluster to ONE partition — a train
   sample never leaks into val/test. The partition is recorded in the
   manifest as ``split`` (web `core/spec.ts` mirror).
4. **Reproducibility** — ``recipe.seed`` + ``recipe.toolVersions`` +
   ``contentHash``: same root + seed + ratios → identical split; regenerate
   is byte-reproducible and any silent change bumps ``version``/``contentHash``.

Pure stdlib (no numpy/ffmpeg): WAV parsing + PCM decoding are deliberate v1
simplifications for the canonical 16 kHz mono s16le form.
"""

from __future__ import annotations

import hashlib
import random
import struct
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

CANONICAL_SAMPLE_RATE = 16000

#: |sample| below this (≈ −63 dBFS) marks a clip as silent/empty.
SILENCE_PEAK_THRESHOLD = 24
#: |sample| at/above this (within 1 LSB of full scale) marks clipping.
CLIPPING_SAMPLE = 32766
#: silence ratio above which the dataset is flagged.
SILENCE_WARN_RATIO = 0.02
#: cosine similarity at/above which two clips' envelopes are near-duplicates.
NEAR_DUP_SIMILARITY = 0.99
#: relative mean-zero-crossing-rate (pitch) tolerance for near-duplicates.
NEAR_DUP_PITCH_TOLERANCE = 0.10
#: near-duplicate candidates must also fall within this relative duration window.
NEAR_DUP_DURATION_TOLERANCE = 0.15
#: label-imbalance (max/min clip count) above which mixing is flagged.
IMBALANCE_WARN_RATIO = 8.0
#: positive labels with fewer distinct voices are flagged (TTS overfit risk).
MIN_POSITIVE_VOICES = 2

WARNING_CODES = {
    "empty-label",
    "silence",
    "clipping",
    "sample-rate-drift",
    "exact-duplicates",
    "near-duplicates",
    "label-imbalance",
    "too-few-voices",
    "all-synthetic-positive",
    "missing-voices-metadata",
}
SEVERITIES = {"info", "warn", "fail"}

#: partition ratios parity with the web split mirrors (train/val/test).
DEFAULT_SPLIT_RATIOS = (0.8, 0.1, 0.1)


class QualityError(RuntimeError):
    """Raised when a dataset root cannot be quality-checked (missing audio/, no clips)."""


# ---------------------------------------------------------------------------
# WAV probing (canonical 16 kHz mono s16le; tolerant of drift)
# ---------------------------------------------------------------------------

class WavMeta:
    """Probed header + decoded samples of one canonical PCM clip."""

    __slots__ = ("sample_rate", "channels", "bits", "frames", "samples")

    def __init__(self, sample_rate: int, channels: int, bits: int,
                 frames: int, samples: list[int]) -> None:
        self.sample_rate = sample_rate
        self.channels = channels
        self.bits = bits
        self.frames = frames
        self.samples = samples

    @property
    def duration_sec(self) -> float:
        return self.frames / self.sample_rate if self.sample_rate else 0.0

    @property
    def peak(self) -> int:
        return max((abs(s) for s in self.samples), default=0)

    @property
    def silent(self) -> bool:
        return self.frames == 0 or self.peak < SILENCE_PEAK_THRESHOLD

    @property
    def clipping(self) -> bool:
        return any(abs(s) >= CLIPPING_SAMPLE for s in self.samples)


def parse_wav(buffer: bytes) -> WavMeta | None:
    """Parse a RIFF/WAVE buffer into a :class:`WavMeta` (None when not a WAV).

    Reads the ``fmt `` + ``data`` chunks (enough for canonical PCM WAVs; no
    decoding for compressed codecs — those are not canonical dataset clips).
    """
    try:
        if buffer[:4] != b"RIFF" or buffer[8:12] != b"WAVE":
            return None
        offset = 12
        fmt: dict[str, int] = {}
        data_start = 0
        data_size = 0
        while offset + 8 <= len(buffer):
            chunk_id = buffer[offset:offset + 4]
            chunk_size = struct.unpack("<I", buffer[offset + 4:offset + 8])[0]
            payload = buffer[offset + 8:offset + 8 + chunk_size]
            if chunk_id == b"fmt " and len(payload) >= 16:
                audio_format, channels, rate, _, _, bits = struct.unpack(
                    "<HHIIHH", payload[:16]
                )
                if audio_format != 1:  # PCM only (canonical form)
                    return None
                fmt = {"channels": channels, "rate": rate, "bits": bits}
            elif chunk_id == b"data":
                data_start = offset + 8
                data_size = chunk_size
            offset += 8 + chunk_size + (chunk_size & 1)  # word-aligned
            if chunk_id == b"data":
                break
        if not fmt:
            return None
        samples: list[int] = []
        if fmt["bits"] == 16:
            available = min(data_size, max(0, len(buffer) - data_start))
            samples = [
                struct.unpack("<h", buffer[j:j + 2])[0]
                for j in range(data_start, data_start + available - 1, 2)
            ]
        if fmt["channels"] != 1:
            samples = samples[:: fmt["channels"]]  # keep only the first channel
        return WavMeta(
            sample_rate=fmt["rate"],
            channels=fmt["channels"],
            bits=fmt["bits"],
            frames=len(samples),
            samples=samples,
        )
    except (struct.error, IndexError, ValueError):
        return None


def _read_clip(path: Path) -> WavMeta | None:
    try:
        return parse_wav(path.read_bytes())
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Perceptual features (dependency-free)
# ---------------------------------------------------------------------------

#: number of windowed mean-|amplitude| values in the envelope feature.
AMPLITUDE_WINDOWS = 16


def amplitude_envelope(samples: list[int]) -> list[float]:
    """Unit-normalized windowed mean-|amplitude| envelope of a clip (16 dims).

    Deterministic and robust to small sample noise (a re-synth of the same
    phrase jitters by a few LSB, which barely moves the means). All-zero / tiny
    clips get a zero vector (never confusable with speech).
    """
    n = len(samples)
    if n < 8:
        return [0.0] * AMPLITUDE_WINDOWS
    amp: list[float] = []
    for i in range(AMPLITUDE_WINDOWS):
        win = samples[(i * n) // AMPLITUDE_WINDOWS:((i + 1) * n) // AMPLITUDE_WINDOWS]
        amp.append(sum(abs(s) for s in win) / max(1, len(win)))
    scale = max(amp) or 1.0
    vec = [a / scale for a in amp]
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


def mean_zero_crossing_rate(samples: list[int]) -> float:
    """Mean fraction of adjacent-sample sign changes (0..1) — a pitch cue.

    Tone pitch scales this ~linearly (harmonics too), so a relative tolerance
    separates a re-synth (same pitch) from a different phrase/pitch.
    """
    n = len(samples)
    if n < 2:
        return 0.0
    crossings = 0
    for a, b in zip(samples, samples[1:]):
        if (a < 0) != (b < 0):
            crossings += 1
    return crossings / (n - 1)


def audio_feature(samples: list[int]) -> tuple[list[float], float]:
    """(amplitude envelope, mean zero-crossing rate) — the perceptual pair.

    ``audio_similarity`` compares envelopes; the pitch tolerance check runs on
    the zcr component inside :func:`near_duplicate_clusters`.
    """
    return amplitude_envelope(samples), mean_zero_crossing_rate(samples)


def audio_similarity(a: Iterable[float], b: Iterable[float]) -> float:
    """Cosine similarity of two unit-normalized envelope vectors (0..1)."""
    return sum(x * y for x, y in zip(a, b))


# ---------------------------------------------------------------------------
# Duplicate scanning
# ---------------------------------------------------------------------------

def _clip_entries(clip_root: Path) -> list[tuple[str, Path]]:
    """Sorted ``(label, path)`` list for every wav under a canonical audio/ root."""
    root = Path(clip_root)
    if not root.is_dir():
        return []
    entries: list[tuple[str, Path]] = []
    for label_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        for wav in sorted(label_dir.glob("*.wav")):
            entries.append((label_dir.name, wav))
    return entries


def exact_duplicate_groups(clip_root: Path) -> dict[str, list[list[str]]]:
    """label → groups of byte-identical clip names (sha256), groups of size > 1."""
    groups: dict[str, list[list[str]]] = {}
    by_hash: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for label, path in _clip_entries(clip_root):
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            continue
        by_hash[digest].append((label, path.name))
    for members in by_hash.values():
        if len(members) < 2:
            continue
        label = members[0][0]
        if any(l != label for l, _ in members):
            continue  # exclude cross-label collisions from exact-dup reporting
        groups.setdefault(label, []).append([name for _, name in members])
    return groups


def near_duplicate_clusters(clip_root: Path) -> list[list[Path]]:
    """Union-find clusters of near-duplicate clips (perceptual fingerprint).

    Same label + same sample rate + duration within NEAR_DUP_DURATION_TOLERANCE
    + Hamming distance ≤ NEAR_DUP_HAMMING → one cluster. Clusters are the
    unit of the reproducible split: assigning a whole cluster to ONE partition
    guarantees no train↔eval leakage.
    """
    entries = _clip_entries(clip_root)
    metas: list[WavMeta | None] = [_read_clip(p) for _, p in entries]
    features: list[tuple[list[float], float]] = [
        audio_feature(m.samples) if m is not None else ([0.0] * AMPLITUDE_WINDOWS, 0.0)
        for m in metas
    ]
    rates = [m.sample_rate if m else 0 for m in metas]
    durations = [m.duration_sec if m else 0.0 for m in metas]

    parent = list(range(len(entries)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            if entries[i][0] != entries[j][0]:
                continue
            if rates[i] != rates[j] or rates[i] == 0:
                continue
            dur_a, dur_b = durations[i], durations[j]
            if dur_a == 0 and dur_b == 0:
                dur_a = dur_b = 1.0  # silent clips compare by feature only
            if abs(dur_a - dur_b) > NEAR_DUP_DURATION_TOLERANCE * max(dur_a, dur_b):
                continue
            env_a, zcr_a = features[i]
            env_b, zcr_b = features[j]
            if audio_similarity(env_a, env_b) < NEAR_DUP_SIMILARITY:
                continue
            zcr_peak = max(zcr_a, zcr_b)
            if zcr_peak > 0 and abs(zcr_a - zcr_b) / zcr_peak > NEAR_DUP_PITCH_TOLERANCE:
                continue
            union(i, j)

    clusters: dict[int, list[Path]] = defaultdict(list)
    for i, (label, path) in enumerate(entries):
        clusters[find(i)].append(path)
    return [sorted(c, key=lambda p: str(p)) for c in clusters.values() if len(c) > 1]


def near_duplicate_pairs(clip_root: Path) -> list[tuple[Path, Path]]:
    """Representative first pair per near-duplicate cluster (for warnings)."""
    pairs: list[tuple[Path, Path]] = []
    for cluster in near_duplicate_clusters(clip_root):
        pairs.append((cluster[0], cluster[1]))
    return pairs


def deduplicate_clips(clip_root: Path, reporter: Any = None) -> dict[str, Any]:
    """Remove exact-duplicate wavs in-place (keep the first by sorted name).

    Called when MIXING datasets so the merged tree never contains a
    byte-identical copy of a clip (evaluation would otherwise see training
    data). Returns stats::

        {"removed": N, "groups": {label: group_count}}

    Near-duplicates are NOT removed silently — they surface as warnings
    (`near-duplicates`) and the reproducible split keeps them out of leakage.
    """
    removed = 0
    groups: dict[str, int] = defaultdict(int)
    for label, paths in exact_duplicate_groups(clip_root).items():
        for group in paths:
            keep = sorted(group)[0]
            for name in group:
                if name == keep:
                    continue
                try:
                    (Path(clip_root) / label / name).unlink()
                    removed += 1
                except OSError:
                    continue
            groups[label] += 1
    if reporter is not None and hasattr(reporter, "emit"):
        reporter.emit("log", level="info", message=f"dedup: removed {removed} exact-duplicate clips")
    elif reporter is not None and hasattr(reporter, "log"):
        reporter.log(level="info", message=f"dedup: removed {removed} exact-duplicate clips")
    return {"removed": removed, "groups": dict(groups)}


# ---------------------------------------------------------------------------
# Health report
# ---------------------------------------------------------------------------

def _label_stats(clip_root: Path, label: str) -> dict[str, Any]:
    """Aggregate metrics for one label folder (duration stats, silence, clipping...)."""
    folder = Path(clip_root) / label
    durations: list[float] = []
    silent = 0
    clipping = 0
    non_standard_rate = 0
    fingerprint_pairs: list[tuple[Path, Path]] = []
    for wav in sorted(folder.glob("*.wav")):
        meta = _read_clip(wav)
        if meta is None:
            continue
        durations.append(meta.duration_sec)
        if meta.silent:
            silent += 1
        if meta.clipping:
            clipping += 1
        if meta.sample_rate != CANONICAL_SAMPLE_RATE:
            non_standard_rate += 1

    def _durations() -> dict[str, float]:
        if not durations:
            return {"clips": 0, "minSec": 0, "maxSec": 0, "meanSec": 0, "totalSec": 0}
        return {
            "clips": len(durations),
            "minSec": round(min(durations), 3),
            "maxSec": round(max(durations), 3),
            "meanSec": round(sum(durations) / len(durations), 3),
            "totalSec": round(sum(durations), 3),
        }

    return {
        "clips": len(durations),
        "duration": _durations(),
        "silent": silent,
        "clipping": clipping,
        "nonStandardSampleRate": non_standard_rate,
    }


def _manifest_voice_info(manifest: dict[str, Any] | None, label: str) -> tuple[list[str] | None, str | None]:
    """(voices list, source) for a label from the manifest (None when absent)."""
    if not manifest:
        return None, None
    for entry in manifest.get("labels") or []:
        if entry.get("name") == label:
            voices = entry.get("voices")
            return list(voices) if isinstance(voices, list) else None, entry.get("source")
    return None, None


def check_dataset(clip_root: Path | str, manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run the full quality gate over a canonical ``audio/`` clip root.

    Returns the health report (JSON-serializable): ``verdict``
    (``pass|warn|fail``), per-label metrics, exact/near-duplicate stats,
    voice + source coverage from the manifest, and a structured
    ``warnings[]`` list (code + severity + message). Raises ``QualityError``
    when the root has no clips at all (nothing to check).
    """
    root = Path(clip_root)
    if not root.is_dir():
        raise QualityError(f"no label folders found under {root}")
    labels = sorted(p.name for p in root.iterdir() if p.is_dir())
    if not labels or labels == ["audio"]:
        # label folders may sit directly under the root (pure tree) or under
        # audio/ (extracted dataset zip) — be lenient about the wrapper dir.
        audio_dir = root / "audio"
        if audio_dir.is_dir():
            return check_dataset(audio_dir, manifest)
        raise QualityError(f"no label folders found under {root}")

    report_labels: dict[str, Any] = {}
    warnings: list[dict[str, str]] = []
    totals = {
        "clips": 0, "silent": 0, "clipping": 0, "nonStandardSampleRate": 0,
        "exactDuplicateGroups": 0, "nearDuplicateClusters": 0,
    }

    exact_by_label = exact_duplicate_groups(root)
    near_by_label: dict[str, int] = defaultdict(int)
    for cluster in near_duplicate_clusters(root):
        near_by_label[cluster[0].parent.name] += 1

    for label in labels:
        stats = _label_stats(root, label)
        if stats["clips"] == 0:
            warnings.append({
                "code": "empty-label",
                "severity": "fail",
                "message": f'label "{label}" has no WAV clips (this label cannot be trained on)',
            })
        exact = exact_by_label.get(label, [])
        near = near_by_label.get(label, 0)

        voices, source = _manifest_voice_info(manifest, label)
        entry = {
            "clips": stats["clips"],
            "duration": stats["duration"],
            "silent": stats["silent"],
            "clipping": stats["clipping"],
            "nonStandardSampleRate": stats["nonStandardSampleRate"],
            "exactDuplicateGroups": len(exact),
            "nearDuplicateClusters": near,
            "voices": len(voices) if voices is not None else None,
            "source": source,
        }
        report_labels[label] = entry
        totals["clips"] += stats["clips"]
        totals["silent"] += stats["silent"]
        totals["clipping"] += stats["clipping"]
        totals["nonStandardSampleRate"] += stats["nonStandardSampleRate"]
        totals["exactDuplicateGroups"] += len(exact)
        totals["nearDuplicateClusters"] += near

    # --- voice coverage + synthetic-to-real gap -------------------------------
    for label in labels:
        voices, source = _manifest_voice_info(manifest, label)
        role = None
        if manifest:
            role = next((l.get("role") for l in manifest.get("labels") or [] if l.get("name") == label), None)
        if role == "positive" and voices is None:
            warnings.append({
                "code": "missing-voices-metadata",
                "severity": "info",
                "message": f'positive label "{label}" has no voice metadata (voices[]) — '
                           "voice-count warnings cannot be computed",
            })
        elif role == "positive" and len(voices) < MIN_POSITIVE_VOICES:
            warnings.append({
                "code": "too-few-voices",
                "severity": "warn",
                "message": f'positive label "{label}" uses {len(voices)} distinct voice(s) '
                           "(< 2): TTS-overfit risk at inference, consider more voices",
            })

    if manifest:
        positives = [l.get("name") for l in manifest.get("labels") or [] if l.get("role") == "positive"]
        if positives and all(
            _manifest_voice_info(manifest, l)[1] == "synthetic" for l in positives
        ):
            warnings.append({
                "code": "all-synthetic-positive",
                "severity": "warn",
                "message": "every wake-word (positive) label is 100% synthetic — verify "
                           "real-voice recognition before relying on it in production",
            })

    # --- content checks -------------------------------------------------------

    # silence/clipping/imbalance ignore role:noise labels (background noise is
    # legitimately low-energy); they only flag synthesis glitches in speech.
    noise_roles = set()
    if manifest:
        noise_roles = {l.get("name") for l in manifest.get("labels") or []
                       if l.get("role") == "noise"}
    content_clips = totals["clips"] - sum(
        report_labels[l]["clips"] for l in report_labels if l in noise_roles
    )
    content_silent = totals["silent"] - sum(
        report_labels[l]["silent"] for l in report_labels if l in noise_roles
    )

    if content_clips > 0 and content_silent / content_clips > SILENCE_WARN_RATIO:
        warnings.append({
            "code": "silence",
            "severity": "warn",
            "message": f"{content_silent} of {content_clips} speech clips are silent/empty "
                       "— check the TTS output and postprocess step",
        })
    if totals["clipping"] > 0:
        warnings.append({
            "code": "clipping",
            "severity": "warn",
            "message": f"{totals['clipping']} clip(s) hit full scale (clipping/distortion)",
        })
    if totals["nonStandardSampleRate"] > 0:
        warnings.append({
            "code": "sample-rate-drift",
            "severity": "warn",
            "message": f"{totals['nonStandardSampleRate']} clip(s) are not 16 kHz — "
                       "materializers/trainers may reject them",
        })
    if totals["exactDuplicateGroups"] > 0:
        warnings.append({
            "code": "exact-duplicates",
            "severity": "warn",
            "message": f"{totals['exactDuplicateGroups']} exact-duplicate group(s) found "
                       "- run dedup when mixing to keep eval clean",
        })
    if totals["nearDuplicateClusters"] > 0:
        warnings.append({
            "code": "near-duplicates",
            "severity": "warn",
            "message": f"{totals['nearDuplicateClusters']} near-duplicate cluster(s) for "
                       "leakage risk - the reproducible split keeps each cluster in one partition",
        })
    if totals["clips"] > 0:
        counts = [report_labels[l]["clips"] for l in report_labels if report_labels[l]["clips"] > 0]
        if counts and max(counts) / min(counts) > IMBALANCE_WARN_RATIO:
            warnings.append({
                "code": "label-imbalance",
                "severity": "warn",
                "message": f"label clip counts are imbalanced (max {max(counts)} vs min {min(counts)} "
                           f"clips, ratio > {IMBALANCE_WARN_RATIO:.0f}x) - thin labels underfit",
            })

    verdict = "fail" if any(w["severity"] == "fail" for w in warnings) else (
        "warn" if any(w["severity"] == "warn" for w in warnings) else "pass"
    )

    import time
    return {
        "schemaVersion": 1,
        "verdict": verdict,
        "checkedAtSec": int(time.time()),
        "totals": totals,
        "labels": report_labels,
        "warnings": warnings,
    }


def quality_summary(report: dict[str, Any]) -> dict[str, Any]:
    """The durable manifest slice of a health report (AC: warnings in manifest).

    ``quality`` is recorded into ``dataset.json`` by the check job (a silent
    content change bumps the dataset ``version``).
    """
    return {
        "checkedAtSec": report.get("checkedAtSec"),
        "verdict": report.get("verdict"),
        "warnings": report.get("warnings", []),
    }


# ---------------------------------------------------------------------------
# Reproducible split
# ---------------------------------------------------------------------------

def _clip_refs(clip_root: Path) -> list[str]:
    """Sorted canonical refs ``audio/<label>/<name>`` for every wav in the tree."""
    refs: list[str] = []
    for label, path in _clip_entries(clip_root):
        refs.append(f"audio/{label}/{path.name}")
    return refs


def distribute_clusters(
    clusters: list[list[Path]],
    ratios: tuple[float, float, float],
    seed: int,
) -> tuple[list[list[Path]], list[list[Path]], list[list[Path]]]:
    """Deterministically assign near-duplicate clusters to train/val/test.

    Seeded shuffle of the sorted clusters, then greedy fill toward the ratio
    targets. Cluster = unit of assignment, so duplicates never straddle
    partitions (no leakage). Deterministic: same clusters + seed + ratios →
    the same partitions.
    """
    rng = random.Random(seed)
    ordered = sorted(clusters, key=lambda c: str(c[0]))
    rng.shuffle(ordered)
    if not ordered:
        return [], [], []
    total = sum(len(c) for c in ordered)
    targets = [r * total for r in ratios]
    buckets: list[list[list[Path]]] = [[], [], []]
    sizes = [0, 0, 0]
    for cluster in ordered:
        # pick the partition whose current fill is farthest below its target
        deficit = [targets[i] - sizes[i] for i in range(3)]
        chosen = max(range(3), key=lambda i: deficit[i])
        buckets[chosen].append(cluster)
        sizes[chosen] += len(cluster)
    # every partition non-empty when the tree is big enough (deterministic:
    # move one cluster out of the largest partition into each empty one)
    empty = [i for i in range(3) if not buckets[i]]
    while empty and len(ordered) >= 3:
        src = max(range(3), key=lambda i: sizes[i])
        if not buckets[src] or sizes[src] <= 1:
            break
        moved = buckets[src].pop()
        sizes[src] -= len(moved)
        target = empty.pop(0)
        buckets[target] = [moved]
        sizes[target] += len(moved)
    return buckets[0], buckets[1], buckets[2]


def split_dataset(
    clip_root: Path | str,
    manifest: dict[str, Any],
    *,
    seed: int = 0,
    ratios: tuple[float, float, float] = DEFAULT_SPLIT_RATIOS,
) -> tuple[dict[str, Any], dict[str, list[str]]]:
    """Compute a reproducible train/val/test partition; returns
    ``(manifest_with_split, partitions)``.

    ``partitions`` = ``{"train": [...refs], "val": [...], "test": [...]}`` where
    refs are canonical ``audio/<label>/<name>`` paths. The manifest copy gains
    ``split`` = ``{"seed", "ratios", train/val/test}`` (the web
    ``core/spec.ts`` ``DatasetSplit`` mirror). ``manifest`` is never mutated.

    The caller decides how to persist the split dataset (a new artifact with a
    new id/version, or an in-place version bump) — the partition record itself
    is the contract every backend trains on (docs/modules/data-sources.md §9.3).
    """
    root = Path(clip_root)
    clusters = near_duplicate_clusters(root)
    singletons = [Path(p) for (_, p) in _clip_entries(root)]
    clustered: set[Path] = {p for c in clusters for p in c}
    singles = [p for p in singletons if p not in clustered]

    # clusters (duplicates must travel as one unit) then individual singles,
    # both with the same seeded, deterministic logic
    train_c, val_c, test_c = distribute_clusters(clusters, ratios, seed)
    train_s, val_s, test_s = distribute_clusters([[s] for s in singles], ratios, seed)

    def _refs(cluster_groups: Iterable[list[Path]]) -> list[str]:
        refs = sorted(f"audio/{p.parent.name}/{p.name}" for g in cluster_groups for p in g)
        return refs

    partitions = {
        "train": _refs([*train_c, *train_s]),
        "val": _refs([*val_c, *val_s]),
        "test": _refs([*test_c, *test_s]),
    }
    out = dict(manifest)
    out["split"] = {
        "seed": seed,
        "ratios": list(ratios),
        "train": partitions["train"],
        "val": partitions["val"],
        "test": partitions["test"],
    }
    return out, partitions