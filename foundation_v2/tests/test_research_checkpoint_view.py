from __future__ import annotations

import pytest

from trading_workspace_v2.store import validate_research_checkpoint_view


def checkpoint(**overrides):
    value = {
        "schema": "research-job-checkpoint-v1",
        "phase": "candidate-ready",
        "attempt_no": 2,
        "result_sha256": "sha256:result",
    }
    value.update(overrides)
    return value


def test_checkpoint_view_projects_public_fields_and_preserves_zero_attempt() -> None:
    view, progress = validate_research_checkpoint_view(
        checkpoint(
            internal_debug="drop-me",
        ),
        {"phase_index": 4, "phase_count": 4, "internal_debug": "drop-me"},
    )

    assert view == {
        "schema": "research-job-checkpoint-v1",
        "phase": "candidate-ready",
        "attempt_no": 2,
        "result_sha256": "sha256:result",
    }
    assert progress == {"phase_index": 4, "phase_count": 4}

    zero_attempt, _ = validate_research_checkpoint_view(
        checkpoint(attempt_no=0), None
    )
    assert zero_attempt["attempt_no"] == 0


@pytest.mark.parametrize(
    "payload",
    [
        checkpoint(attempt_no=True),
        checkpoint(attempt_no=-1),
        checkpoint(schema="other-schema"),
        checkpoint(phase=""),
        checkpoint(lease_expires_at_utc="2030-01-01T00:00:00Z"),
        checkpoint(holdout_access=True),
        checkpoint(trial_status_counts={"completed": 1, "lease_token": 1}),
        checkpoint(trial_status_counts={"completed": -1}),
        checkpoint(nested={"lease_token": "secret"}),
        checkpoint(trial_outcomes=[{"trial_id": "t1", "status": "unknown"}]),
    ],
)
def test_checkpoint_view_rejects_untrusted_shapes(payload) -> None:
    with pytest.raises(ValueError):
        validate_research_checkpoint_view(payload, None)


def test_checkpoint_view_rejects_forbidden_progress_fields() -> None:
    with pytest.raises(ValueError, match="progress.lease_owner"):
        validate_research_checkpoint_view(
            checkpoint(), {"phase_index": 1, "lease_owner": "worker-a"}
        )


@pytest.mark.parametrize(
    "progress",
    [
        {"phase_index": True, "phase_count": 4},
        {"phase_index": -1, "phase_count": 4},
        {"phase_index": 5, "phase_count": 4},
        {"trial_index": True, "trial_count": 3},
        {"trial_index": -1, "trial_count": 3},
        {"trial_index": 4, "trial_count": 3},
    ],
)
def test_checkpoint_view_rejects_invalid_public_progress_cursors(progress) -> None:
    with pytest.raises(ValueError, match="progress|cursor"):
        validate_research_checkpoint_view(checkpoint(), progress)
