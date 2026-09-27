from __future__ import annotations

import copy

import pytest

from trading_workspace_v2.zone_lifecycle import (
    PREP_ONLY_MODE,
    ZONE_ENGINE,
    ZONE_TRANSITION_SCHEMA,
    ZoneLifecycleConfig,
    ZoneLifecycleError,
    build_order_block_lifecycle,
    build_order_block_spec,
    build_ote_lifecycle,
    build_ote_spec,
    validate_zone_transition,
)


def bar(timestamp: int, opening: float, high: float, low: float, close: float) -> dict:
    return {
        "timestamp": timestamp,
        "open": opening,
        "high": high,
        "low": low,
        "close": close,
    }


def bullish_ob_bars() -> list[dict]:
    return [
        bar(100, 10.0, 11.0, 9.0, 10.0),
        bar(160, 10.0, 11.5, 9.8, 11.0),
        bar(220, 11.0, 12.0, 10.0, 10.5),  # nearest bearish origin
        bar(280, 10.5, 13.0, 10.4, 12.5),  # confirmed bullish BOS
        bar(340, 12.5, 13.0, 11.5, 11.8),  # mitigation touch
        bar(400, 11.8, 12.0, 9.5, 9.8),  # close-through invalidation
    ]


def bullish_bos() -> dict:
    return {
        "schema": "chart-event-v1",
        "event_id": "bos:bullish:280",
        "kind": "BOS",
        "direction": "bullish",
        "instrument_id": "EURUSD",
        "timeframe_seconds": 60,
        "anchor_timestamp": 280,
        "known_at": 280,
        "source_bar_ids": ["bar:100", "bar:280"],
        "price_low": 11.0,
        "price_high": 12.5,
        "state": "confirmed",
        "confirmation_lag_bars": 0,
        "rule_version": "smc-core.v1",
        "parameters": {"protected_swing": "high", "close_break": True},
        "identity": {"protected": 100, "break": 280, "direction": "bullish"},
    }


def test_order_block_is_published_only_after_confirmed_bos_and_keeps_origin_policy() -> None:
    config = ZoneLifecycleConfig("EURUSD", 60, range_mode="wick")
    spec = build_order_block_spec(bullish_ob_bars(), bullish_bos(), config)

    assert spec.kind == "ORDER_BLOCK"
    assert spec.direction == "bullish"
    assert spec.anchor_timestamp == 220
    assert spec.known_at == 280
    assert (spec.price_low, spec.price_high) == (10.0, 12.0)
    assert spec.parameters["standalone_entry"] is False
    assert spec.parameters["origin_timestamp"] == 220
    assert spec.parameters["displacement_timestamp"] == 280
    assert spec.source_bar_ids == ("bar:100", "bar:280", "bar:220")

    future_source = copy.deepcopy(bullish_bos())
    future_source["source_bar_ids"].append("bar:340")
    with pytest.raises(ZoneLifecycleError, match="source bar exceeds known_at"):
        build_order_block_spec(bullish_ob_bars(), future_source, config)


def test_order_block_lifecycle_is_causal_and_invalidates_after_mitigation() -> None:
    config = ZoneLifecycleConfig("EURUSD", 60, range_mode="wick")
    transitions = build_order_block_lifecycle(bullish_ob_bars(), bullish_bos(), config)

    assert [transition.state for transition in transitions] == [
        "confirmed",
        "mitigated",
        "invalidated",
    ]
    assert [transition.known_at for transition in transitions] == [280, 340, 400]
    assert transitions[1].parameters["previous_state"] == "confirmed"
    assert transitions[2].parameters["transition_reason"] == "close_through"
    assert all(
        int(source_id[4:]) <= transition.known_at
        for transition in transitions
        for source_id in transition.source_bar_ids
        if source_id.startswith("bar:")
    )
    assert len({transition.event_id for transition in transitions}) == 3


def test_order_block_prefix_never_sees_future_lifecycle_transition() -> None:
    config = ZoneLifecycleConfig("EURUSD", 60, range_mode="wick")
    prefix = build_order_block_lifecycle(
        bullish_ob_bars()[:5], bullish_bos(), config, cutoff_timestamp=340
    )
    full_cutoff = build_order_block_lifecycle(
        bullish_ob_bars(), bullish_bos(), config, cutoff_timestamp=340
    )
    assert [item.as_dict() for item in prefix] == [item.as_dict() for item in full_cutoff]
    assert all(item.known_at <= 340 for item in full_cutoff)


def test_body_range_and_invalidation_precedence_are_explicit() -> None:
    config = ZoneLifecycleConfig(
        "EURUSD",
        60,
        range_mode="body",
        mitigation_mode="touch",
        invalidation_mode="close_through",
    )
    spec = build_order_block_spec(bullish_ob_bars(), bullish_bos(), config)
    assert (spec.price_low, spec.price_high) == (10.5, 11.0)

    # The bar touches the zone but also closes below its invalidation boundary;
    # invalidation has precedence and no misleading mitigated transition is
    # emitted for that bar.
    crossing = bullish_ob_bars()[:4] + [bar(340, 11.0, 11.5, 9.8, 9.9)]
    transitions = build_order_block_lifecycle(crossing, bullish_bos(), config)
    assert [item.state for item in transitions] == ["confirmed", "invalidated"]


def test_ote_uses_confirmed_leg_and_never_advertises_standalone_entry() -> None:
    bars = [
        bar(100, 10.0, 11.0, 10.0, 10.5),
        bar(160, 10.5, 15.0, 10.0, 14.0),
        bar(220, 14.0, 20.0, 13.5, 19.0),
        bar(280, 19.0, 19.5, 12.5, 13.0),
        bar(340, 13.0, 14.0, 11.0, 11.8),
    ]
    config = ZoneLifecycleConfig("EURUSD", 60)
    spec = build_ote_spec(
        bars,
        config=config,
        direction="bullish",
        leg_start_timestamp=100,
        leg_end_timestamp=220,
    )

    assert spec.kind == "OTE"
    assert (spec.price_low, spec.price_high) == pytest.approx((12.1, 13.8))
    assert spec.known_at == 220
    assert spec.parameters["standalone_entry"] is False
    assert spec.parameters["leg_start_timestamp"] == 100
    assert spec.parameters["leg_end_timestamp"] == 220

    transitions = build_ote_lifecycle(
        bars,
        config=config,
        direction="bullish",
        leg_start_timestamp=100,
        leg_end_timestamp=220,
    )
    assert transitions[0].state == "confirmed"
    assert transitions[1].state == "mitigated"


def test_bearish_ote_math_and_invalid_leg_are_fail_closed() -> None:
    bars = [
        bar(100, 20.0, 22.0, 19.0, 21.0),
        bar(160, 21.0, 21.5, 15.0, 16.0),
        bar(220, 16.0, 16.5, 12.0, 13.0),
    ]
    config = ZoneLifecycleConfig("EURUSD", 60)
    spec = build_ote_spec(
        bars,
        config=config,
        direction="bearish",
        leg_start_timestamp=100,
        leg_end_timestamp=220,
    )
    assert (spec.price_low, spec.price_high) == pytest.approx((18.2, 19.9))
    with pytest.raises(ZoneLifecycleError, match="must fall"):
        build_ote_spec(
            [*bars, bar(280, 17.0, 18.0, 17.0, 17.5)],
            config=config,
            direction="bearish",
            leg_start_timestamp=220,
            leg_end_timestamp=280,
        )


def test_expiry_is_terminal_and_deterministic() -> None:
    bars = [
        bar(100, 10.0, 11.0, 9.0, 10.0),
        bar(160, 10.0, 10.2, 9.8, 10.1),
        bar(220, 10.1, 10.3, 9.9, 10.2),
        bar(280, 10.2, 10.4, 10.0, 10.3),
    ]
    # Reuse a confirmed OTE leg whose zone sits above this quiet continuation.
    config = ZoneLifecycleConfig("EURUSD", 60, expiry_bars=2)
    zone = build_ote_spec(
        [bar(1, 1.0, 2.0, 0.9, 1.5), bar(2, 1.5, 2.0, 1.4, 1.8), *bars],
        config=config,
        direction="bullish",
        leg_start_timestamp=1,
        leg_end_timestamp=2,
    )
    transitions = __import__("trading_workspace_v2.zone_lifecycle", fromlist=["evaluate_zone_lifecycle"]).evaluate_zone_lifecycle(
        bars,
        zone,
        config,
        cutoff_timestamp=220,
    )
    assert [item.state for item in transitions] == ["confirmed", "expired"]
    assert transitions[-1].known_at == 160


def test_zone_transition_serialization_is_strict_and_execution_free() -> None:
    config = ZoneLifecycleConfig("EURUSD", 60)
    transition = build_order_block_lifecycle(bullish_ob_bars(), bullish_bos(), config)[0]
    payload = transition.as_dict()
    assert payload["schema"] == ZONE_TRANSITION_SCHEMA
    assert payload["mode"] == PREP_ONLY_MODE
    assert payload["engine"] == ZONE_ENGINE
    assert validate_zone_transition(payload) == payload

    unsafe = copy.deepcopy(payload)
    unsafe["parameters"]["order_send"] = True
    with pytest.raises(ZoneLifecycleError, match="forbidden"):
        validate_zone_transition(unsafe)

    unknown_state = copy.deepcopy(payload)
    unknown_state["state"] = "provisional"
    with pytest.raises(ZoneLifecycleError, match="state is unsupported"):
        validate_zone_transition(unknown_state)

    forged_id = copy.deepcopy(payload)
    forged_id["event_id"] = "0" * 64
    with pytest.raises(ZoneLifecycleError, match="event_id does not match"):
        validate_zone_transition(forged_id)


def test_lifecycle_policy_is_part_of_zone_identity() -> None:
    default = ZoneLifecycleConfig("EURUSD", 60, invalidation_mode="close_through")
    wick = ZoneLifecycleConfig("EURUSD", 60, invalidation_mode="wick_through")
    default_zone = build_order_block_spec(bullish_ob_bars(), bullish_bos(), default)
    wick_zone = build_order_block_spec(bullish_ob_bars(), bullish_bos(), wick)
    assert default_zone.zone_id != wick_zone.zone_id


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"range_mode": "unknown"}, "range_mode"),
        ({"mitigation_mode": "wick"}, "mitigation_mode"),
        ({"invalidation_mode": "touch"}, "invalidation_mode"),
    ],
)
def test_invalid_lifecycle_policy_fails_closed(kwargs: dict, message: str) -> None:
    with pytest.raises(ZoneLifecycleError, match=message):
        ZoneLifecycleConfig("EURUSD", 60, **kwargs)
