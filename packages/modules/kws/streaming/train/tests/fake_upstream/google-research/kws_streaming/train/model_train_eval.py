"""Fake upstream kws_streaming trainer for the adapter tests (no GPU/network).

Accepts the same base flags the real ``model_train_eval.py`` takes and writes
the run-dir outputs the adapter normalizes: the streaming tflite, labels,
flags and the accuracy files. It never reads the data dir.
"""

import argparse
import json
import os
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_url", default="")
    parser.add_argument("--data_dir", default="")
    parser.add_argument("--train_dir", default="")
    parser.add_argument("--wanted_words", default="yes")
    parser.add_argument("--split_data", type=int, default=1)
    parser.add_argument("--preprocess", default="raw")
    parser.add_argument("--feature_type", default="mfcc_tf")
    parser.add_argument("--how_many_training_steps", default="10000,10000,10000")
    parser.add_argument("--learning_rate", default="0.0005,0.0001,0.00002")
    parser.add_argument("--background_volume", type=float, default=0.1)
    parser.add_argument("--background_frequency", type=float, default=0.8)
    parser.add_argument("--silence_percentage", type=float, default=10.0)
    parser.add_argument("--unknown_percentage", type=float, default=10.0)
    parser.add_argument("--train", type=int, default=1)
    parser.add_argument("model")
    args, _unknown = parser.parse_known_args()

    if os.environ.get("FAKE_STREAM_FAIL") == "1":
        print("fake upstream: failing on purpose")
        return 3

    print("fake upstream: starting training")
    train_dir = Path(args.train_dir)
    stream_dir = train_dir / "tflite_stream_state_external"
    stream_dir.mkdir(parents=True, exist_ok=True)

    # labels: wanted words + _silence_ + _unknown_ (mirrors upstream)
    wanted = [w.strip() for w in args.wanted_words.split(",") if w.strip()]
    labels = ["_silence_", "_unknown_"] + wanted
    (train_dir / "labels.txt").write_text("\n".join(labels) + "\n", encoding="utf-8")
    (train_dir / "flags.json").write_text(
        json.dumps({
            "model_name": args.model,
            "wanted_words": args.wanted_words,
            "feature_type": args.feature_type,
            "preprocess": args.preprocess,
        }, indent=2),
        encoding="utf-8",
    )
    if os.environ.get("FAKE_STREAM_NO_MODEL") != "1":
        (stream_dir / "stream_state_external.tflite").write_bytes(
            b"fake-streaming-tflite:" + args.model.encode("utf-8")
        )
    (stream_dir / "tflite_stream_state_external_model_accuracy_reset0.txt").write_text(
        "TFLite test accuracy = 0.98 (reset0)\n", encoding="utf-8"
    )
    (stream_dir / "tflite_stream_state_external_model_accuracy_reset1.txt").write_text(
        "TFLite test accuracy = 0.97 (reset1)\n", encoding="utf-8"
    )
    (train_dir / "accuracy_last.txt").write_text(
        "last step accuracy = 0.99\n", encoding="utf-8"
    )

    print("fake upstream: eval step 1/3 loss=1.2")
    print("fake upstream: eval step 2/3 loss=0.4")
    print("fake upstream: training done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
