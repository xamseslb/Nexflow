from unittest.mock import Mock
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import OperationalError

from app import worker


def test_batch_exits_on_empty_queue_without_sleeping(monkeypatch):
    run = Mock(side_effect=[True, True, False])
    monkeypatch.setattr(worker, "run_once", run)
    monkeypatch.setattr(worker.time, "sleep", Mock(side_effect=AssertionError("must not wait")))
    assert worker.run_batch(None, None) == {"processed": 2, "stop_reason": "queue_empty"}
    assert run.call_count == 3


def test_batch_limits_busy_queue(monkeypatch):
    run = Mock(return_value=True)
    monkeypatch.setattr(worker, "run_once", run)
    assert worker.run_batch(None, None, max_jobs=3) == {"processed": 3, "stop_reason": "job_limit"}
    assert run.call_count == 3


def test_batch_checks_deadline_before_next_job(monkeypatch):
    run = Mock(return_value=True)
    monkeypatch.setattr(worker, "run_once", run)
    monkeypatch.setattr(worker.time, "monotonic", Mock(side_effect=[100, 100, 221]))
    assert worker.run_batch(None, None, max_seconds=120) == {"processed": 1, "stop_reason": "time_limit"}
    assert run.call_count == 1


@pytest.mark.parametrize("limits", [{"max_jobs": 0}, {"max_jobs": -1}, {"max_seconds": 0}])
def test_invalid_limits_fail_before_work(monkeypatch, limits):
    run = Mock()
    monkeypatch.setattr(worker, "run_once", run)
    with pytest.raises(ValueError):
        worker.run_batch(None, None, **limits)
    run.assert_not_called()


def test_batch_failure_is_not_reported_as_success(monkeypatch):
    monkeypatch.setattr(worker, "run_once", Mock(side_effect=RuntimeError("unavailable")))
    with pytest.raises(RuntimeError):
        worker.run_batch(None, None)


def test_cli_database_failure_is_redacted_and_engine_closed(monkeypatch, capsys):
    engine = Mock()
    monkeypatch.setattr("sys.argv", ["worker", "--batch"])
    monkeypatch.setattr(worker, "settings", lambda: SimpleNamespace(worker_database_url="secret"))
    monkeypatch.setattr(worker, "check_production", Mock())
    monkeypatch.setattr(worker, "create_engine", Mock(return_value=engine))
    monkeypatch.setattr(worker, "run_once", Mock(side_effect=OperationalError(
        "private SQL", {"customer": "private name"}, Exception("private password"))))
    with pytest.raises(SystemExit) as result:
        worker.main()
    assert "private" not in str(result.value)
    assert "failed" in str(result.value)
    assert capsys.readouterr().out == ""
    engine.dispose.assert_called_once()


def test_cli_rejects_conflicting_modes_before_connecting(monkeypatch):
    monkeypatch.setattr("sys.argv", ["worker", "--once", "--batch"])
    engine = Mock()
    monkeypatch.setattr(worker, "create_engine", engine)
    with pytest.raises(SystemExit) as result:
        worker.main()
    assert result.value.code == 2
    engine.assert_not_called()
