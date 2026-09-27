from __future__ import annotations

import copy

import pytest

from trading_workspace_v2.chart_renderer_contract import RendererViewport
from trading_workspace_v2.chart_visible_range_adapter import (
    VISIBLE_RANGE_RESPONSE_SCHEMA,
    VisibleRangeAdapterError,
    VisibleRangeRequest,
    adapt_visible_range,
)

from test_chart_renderer_contract import packet


def request_for(value: dict, *, expected_generation: int | None = None) -> VisibleRangeRequest:
    return VisibleRangeRequest(
        request_id="browser-qa-1",
        source=copy.deepcopy(value["source"]),
        cutoff_timestamp=value["cutoff_timestamp"],
        indicator_sha256=value["indicator_sha256"],
        viewport=RendererViewport(1_700_000_000, 1_700_000_180),
        expected_generation=expected_generation,
    )


def test_visible_range_adapter_reconciles_plan_and_binds_scope() -> None:
    source = packet(statuses=("committed",))
    request = request_for(source)

    first = adapt_visible_range(source, request)
    assert first.status == "ok"
    assert first.reason is None
    assert first.plan is not None
    assert first.plan.viewport == request.viewport
    assert first.plan.next_state.generation == 1
    assert first.as_dict()["schema"] == VISIBLE_RANGE_RESPONSE_SCHEMA
    assert first.as_dict()["plan"]["source"] == source["source"]

    second = adapt_visible_range(
        source,
        request_for(source, expected_generation=first.plan.next_state.generation),
        previous_state=first.plan.next_state,
    )
    assert second.status == "ok"
    assert second.plan is not None
    assert second.plan.next_state.generation == 2


@pytest.mark.parametrize(
    ("field", "value", "reason"),
    [
        ("source", {"kind": "replay", "id": "other", "dataset_id": "fixture"}, "scope_mismatch"),
        ("cutoff_timestamp", 1_700_000_181, "scope_mismatch"),
        ("indicator_sha256", "0" * 64, "scope_mismatch"),
    ],
)
def test_visible_range_adapter_rejects_scope_mismatch_without_plan(
    field: str, value: object, reason: str
) -> None:
    value_packet = packet(statuses=("committed",))
    payload = request_for(value_packet).__dict__
    payload[field] = value
    request = VisibleRangeRequest(**payload)

    response = adapt_visible_range(value_packet, request)
    assert response.status == "rejected"
    assert response.reason == reason
    assert response.plan is None


def test_visible_range_adapter_rejects_generation_conflict_before_rendering() -> None:
    value_packet = packet(statuses=("committed",))
    first = adapt_visible_range(value_packet, request_for(value_packet))
    assert first.plan is not None

    conflict = adapt_visible_range(
        value_packet,
        request_for(value_packet, expected_generation=99),
        previous_state=first.plan.next_state,
    )
    assert conflict.status == "rejected"
    assert conflict.reason == "generation_conflict"
    assert conflict.plan is None


def test_visible_range_request_from_payload_is_strict_and_provider_free() -> None:
    value_packet = packet(statuses=("committed",))
    payload = {
        "schema": "chart-visible-range-request-v1",
        "mode": "PREP_ONLY",
        "adapter": "browser-visible-range",
        "request_id": "browser-qa-2",
        "source": value_packet["source"],
        "cutoff_timestamp": value_packet["cutoff_timestamp"],
        "indicator_sha256": value_packet["indicator_sha256"],
        "viewport": {"start_timestamp": 1_700_000_000, "end_timestamp": 1_700_000_180},
        "expected_generation": None,
    }
    request = VisibleRangeRequest.from_payload(payload)
    assert request.as_dict()["adapter"] == "browser-visible-range"
    with pytest.raises(VisibleRangeAdapterError, match="unsupported field"):
        VisibleRangeRequest.from_payload({**payload, "provider": "network"})
