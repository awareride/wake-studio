"""Unit tests for NDJSON report-line parsing."""

from wake_training_service.ndjson import parse_report_line


def test_parses_report_events():
    assert parse_report_line(
        '{"event":"progress","step":2,"total":7,"progress":0.28,"message":"x"}'
    )["event"] == "progress"
    assert parse_report_line('{"event":"heartbeat"}')["event"] == "heartbeat"
    assert parse_report_line('{"event":"artifact","path":"out/model.onnx"}')["event"] == "artifact"


def test_ignores_non_report_lines():
    assert parse_report_line("") is None
    assert parse_report_line("   ") is None
    assert parse_report_line("# comment") is None
    assert parse_report_line("epoch 3/10 done, loss=0.12") is None
    assert parse_report_line("not json at all") is None
    assert parse_report_line('{"no":"event"}') is None
    assert parse_report_line('["an","array"]') is None
    assert parse_report_line('{"event":"unknown-thing"}') is None


def test_ignores_malformed_json():
    assert parse_report_line('{"event":') is None
    assert parse_report_line('{"event":"progress"') is None
