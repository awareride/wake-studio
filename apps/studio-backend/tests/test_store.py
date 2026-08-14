"""Store tests - SQLite persistence for jobs + artifact index."""

from wake_training_service.models import Job, JobStatus
from wake_training_service.store import Store


def test_job_crud(tmp_path):
    store = Store(tmp_path / "db.sqlite")
    job = Job(id="a", module_id="fake", params={"epochs": "10"})
    store.create_job(job)

    got = store.get_job("a")
    assert got is not None
    assert got.module_id == "fake"
    assert got.params == {"epochs": "10"}
    assert got.status is JobStatus.QUEUED

    got.progress = 0.5
    got.append_log('{"event":"progress"}')
    store.update_job(got)
    got2 = store.get_job("a")
    assert got2.progress == 0.5
    assert got2.log == ['{"event":"progress"}']

    assert [j.id for j in store.list_jobs()] == ["a"]
    store.delete_job("a")
    assert store.get_job("a") is None
    store.close()


def test_artifacts_index(tmp_path):
    store = Store(tmp_path / "db.sqlite")
    store.create_job(Job(id="a", module_id="fake"))
    store.add_artifact("a", "model.onnx", "/tmp/model.onnx", "abc123", 12)
    store.add_artifact("a", "metrics.json", "/tmp/metrics.json", "def456", 8)

    art = store.get_artifact("a", "model.onnx")
    assert art["sha256"] == "abc123"
    assert [a["name"] for a in store.list_artifacts("a")] == ["model.onnx", "metrics.json"]
    assert store.get_artifact("a", "nope") is None

    store.delete_artifacts("a")
    assert store.list_artifacts("a") == []
    store.close()


def test_persists_across_store_instances(tmp_path):
    db = tmp_path / "db.sqlite"
    s1 = Store(db)
    s1.create_job(Job(id="a", module_id="fake", params={"x": "1"}))
    s1.close()

    s2 = Store(db)
    job = s2.get_job("a")
    assert job is not None
    assert job.params == {"x": "1"}
    assert job.status is JobStatus.QUEUED
    s2.close()
