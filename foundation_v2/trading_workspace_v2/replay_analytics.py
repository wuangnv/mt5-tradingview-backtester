"""Project persisted replay fills onto the canonical closed-trade analytics model."""

from decimal import Decimal, InvalidOperation
from math import isfinite

from .analytics_read_model import AnalyticsValidationError, build_analytics_view
from .replay_execution import parse_replay_execution_snapshot, replay_event_for_snapshot


def _decimal(value, name, *, positive=False):
    try:
        number = Decimal(str(value))
        if not number.is_finite() or (positive and number <= 0):
            raise ValueError(name)
        return number
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise AnalyticsValidationError(f"replay {name} is invalid") from exc


def _number(value, name, *, positive=False):
    result = float(_decimal(value, name, positive=positive))
    if not isfinite(result):
        raise AnalyticsValidationError(f"replay {name} is invalid")
    return result


def build_replay_analytics_view(view: dict, filters: dict | None = None) -> dict:
    """Accept a persisted replay record; bar data is neither needed nor returned.

    Gross P/L, fee breakdown and planned risk are not persisted on replay fill
    events. Keep them unknown instead of reverse-engineering financial inputs.
    """
    payload = view["payload"]
    session_id = view["record_id"]
    base = {
        "session_id": session_id,
        "workspace_id": view.get("workspace_id"),
        "dataset_id": payload["dataset_id"],
        "dataset_sha256": view.get("dataset_sha256"),
        "revision": view["revision"],
        "branch_id": payload.get("branch_id"),
        "parent_session_id": payload.get("parent_session_id"),
        "cursor_index": payload["cursor_index"],
        "canonical_cursor_index": view.get("canonical_cursor_index", payload["cursor_index"]),
        "canonical_execution_event_sequence": view.get("canonical_execution_event_sequence"),
        "historical_view": view.get("historical_view", False),
        "cutoff_timestamp": view.get("cutoff_timestamp"),
        "created_at_utc": view.get("updated_at_utc"),
        "mode": "replay",
        "timezone": "UTC",
    }
    raw = payload.get("execution")
    if raw is None:
        result = build_analytics_view(base, filters)
        result["blocked_by_data"] = ["replay_execution_not_initialized"]
    else:
        snapshot = parse_replay_execution_snapshot(raw)
        if (snapshot.replay_session_id != session_id
                or snapshot.dataset_id != payload["dataset_id"]
                or snapshot.branch_id != payload.get("branch_id")
                or snapshot.cursor_index != payload["cursor_index"]
                or snapshot.event_sequence != len(snapshot.ledger)):
            raise AnalyticsValidationError("replay execution lineage is inconsistent")
        if base["dataset_sha256"] and base["dataset_sha256"] != snapshot.dataset_sha256:
            raise AnalyticsValidationError("replay dataset hash is inconsistent")
        opened = {}
        position_ids = set()
        trades = []
        cutoff = None
        last_cursor = -1
        last_time = -1
        balance = snapshot.starting_balance
        last_event = None
        phase_transitions = 0
        phase_initial_balance = snapshot.starting_balance
        rejections = []
        consumed_operations = set()
        for sequence, raw_event in enumerate(snapshot.ledger, start=1):
            event = replay_event_for_snapshot(snapshot, raw_event)
            if (event.sequence != sequence
                    or event.replay_session_id != session_id
                    or event.branch_id != snapshot.branch_id
                    or event.dataset_id != snapshot.dataset_id
                    or event.dataset_sha256 != snapshot.dataset_sha256
                    or not last_cursor <= event.cursor_index <= snapshot.cursor_index
                    or event.virtual_time_utc < last_time):
                raise AnalyticsValidationError("replay event lineage is inconsistent")
            last_cursor = event.cursor_index
            last_time = event.virtual_time_utc
            cutoff = max(cutoff or 0, event.virtual_time_utc)
            detail = event.details
            position_id = detail.get("position_id")
            if snapshot.schema_version in {"replay-execution-v2", "replay-execution-tick-v1"} and event.kind in {"market_fill", "order_rejected"}:
                operation_id = detail.get("operation_id")
                if operation_id in consumed_operations:
                    raise AnalyticsValidationError("replay order outcome is duplicated")
                consumed_operations.add(operation_id)
            if event.kind == "market_fill":
                if (not isinstance(position_id, str) or not position_id.strip()
                        or position_id in position_ids or opened
                        or not isinstance(detail.get("operation_id"), str) or not detail["operation_id"].strip()
                        or detail.get("side") not in {"BUY", "SELL"}):
                    raise AnalyticsValidationError("replay opening fill is inconsistent")
                _number(detail.get("quantity"), "quantity", positive=True)
                _number(detail.get("fill_price"), "entry price", positive=True)
                position_ids.add(position_id)
                opened[position_id] = event
            elif event.kind == "protective_fill":
                if not isinstance(position_id, str):
                    raise AnalyticsValidationError("replay closing fill position is invalid")
                entry = opened.pop(position_id, None)
                if entry is None or entry.details.get("operation_id") != detail.get("operation_id"):
                    raise AnalyticsValidationError("replay closing fill has no matching opening fill")
                balance += _decimal(detail.get("net_pnl"), "net pnl")
                trades.append({
                    "trade_id": position_id,
                    "session_id": session_id,
                    "source_position_id": position_id,
                    "source_operation_id": detail.get("operation_id"),
                    "source": {"session_id": session_id, "revision": view["revision"]},
                    "symbol": snapshot.instrument_spec["instrument_id"],
                    "side": entry.details["side"],
                    "quantity": _number(entry.details["quantity"], "quantity", positive=True),
                    "open_time_utc": entry.virtual_time_utc,
                    "close_time_utc": event.virtual_time_utc,
                    "open_cursor_index": entry.cursor_index,
                    "close_cursor_index": event.cursor_index,
                    "close_event_sequence": event.sequence,
                    "close_phase_index": phase_transitions + 1,
                    "price_open": _number(entry.details["fill_price"], "entry price", positive=True),
                    "price_close": _number(detail.get("fill_price"), "exit price", positive=True),
                    "net_pnl": _number(detail["net_pnl"], "net pnl"),
                    "gross_pnl": None,
                    "fees": None,
                    "planned_risk_budget": None,
                    "realized_r": None,
                    "exit_reason": detail.get("reason"),
                })
            elif event.kind == "order_rejected":
                rejections.append({"event_sequence": event.sequence, "cursor_index": event.cursor_index,
                                   "virtual_time_utc": event.virtual_time_utc, **detail})
            elif event.kind == "phase_transition":
                if (detail.get("from_phase_index") != phase_transitions + 1
                        or detail.get("to_phase_index") != phase_transitions + 2
                        or _decimal(detail.get("from_balance"), "phase from balance") != balance):
                    raise AnalyticsValidationError("replay phase transition is inconsistent")
                policy = detail.get("carry_policy")
                position_policy = detail.get("position_policy")
                next_initial = _decimal(detail.get("next_phase_initial_balance"), "phase balance", positive=True)
                if (position_policy not in {"must_be_flat", "carry", "close_by_simulator"}
                        or (opened and (policy != "carry_all" or position_policy != "carry"))):
                    raise AnalyticsValidationError("replay phase position policy is inconsistent")
                if policy == "reset":
                    if opened:
                        raise AnalyticsValidationError("replay balance reset has an open position")
                    balance = next_initial
                elif policy not in {"carry_balance", "carry_all"}:
                    raise AnalyticsValidationError("replay phase carry policy is invalid")
                if _decimal(detail.get("to_balance"), "phase to balance") != balance:
                    raise AnalyticsValidationError("replay phase balance is inconsistent")
                prior_floating = last_event.floating_pl if last_event else Decimal("0")
                expected_floating = prior_floating if policy == "carry_all" else Decimal("0")
                if (event.pending_orders != 0
                        or event.floating_pl != expected_floating
                        or _decimal(detail.get("from_floating_pl"), "phase from floating pnl") != prior_floating
                        or _decimal(detail.get("from_equity"), "phase from equity") != (
                            last_event.equity if last_event else snapshot.starting_balance)
                        or _decimal(detail.get("to_floating_pl"), "phase to floating pnl") != event.floating_pl
                        or _decimal(detail.get("to_equity"), "phase to equity") != event.equity):
                    raise AnalyticsValidationError("replay phase account state is inconsistent")
                phase_transitions += 1
                phase_initial_balance = next_initial
            if event.balance != balance or event.open_positions != len(opened):
                raise AnalyticsValidationError("replay event account state is inconsistent")
            last_event = event
        if (snapshot.balance != balance or snapshot.phase_index != phase_transitions + 1
                or ((snapshot.phase_initial_balance is not None or phase_transitions)
                    and snapshot.phase_initial_balance != phase_initial_balance)
                or (last_event is not None and (
                    last_event.cursor_index != snapshot.cursor_index
                    or last_event.floating_pl != snapshot.floating_pl
                    or last_event.equity != snapshot.equity))):
            raise AnalyticsValidationError("replay snapshot account state is inconsistent")
        position = snapshot.position
        if (len(opened) != int(position is not None)
                or (position is not None and position.position_id not in opened)):
            raise AnalyticsValidationError("replay snapshot position is inconsistent")
        base.update({
            "dataset_sha256": snapshot.dataset_sha256,
            "instrument_id": snapshot.instrument_spec["instrument_id"],
            "timeframe": f"{snapshot.timeframe_seconds}s",
            "timeframe_seconds": snapshot.timeframe_seconds,
            "account_currency": snapshot.instrument_spec.get("account_ccy"),
            "cutoff_timestamp": cutoff or base["cutoff_timestamp"],
            "open_position_count": int(snapshot.position is not None),
            "pending_order_count": int(snapshot.pending_market_order is not None),
            "phase_transition_count": phase_transitions,
            "execution_event_sequence": snapshot.event_sequence,
            "phase_index": snapshot.phase_index,
            "phase_initial_balance": _number(snapshot.phase_initial_balance or snapshot.starting_balance,
                                               "phase initial balance", positive=True),
            "data_quality": snapshot.evaluation_quality,
        })
        result = build_analytics_view({
            **base,
            "protocol": {"starting_balance": _number(snapshot.starting_balance, "starting balance", positive=True)},
            "ledger": trades,
        }, filters)
        if snapshot.schema_version in {"replay-execution-v2", "replay-execution-tick-v1"}:
            result["order_rejections"] = rejections
            result["rejected_order_count"] = len(rejections)
            result["research_margin"] = snapshot.research_margin.model_dump(mode="json")
        if snapshot.schema_version == 'replay-execution-tick-v1':
            result['provenance'].update(tick_snapshot_id=snapshot.tick_snapshot_id,
                tick_snapshot_sha256=snapshot.tick_snapshot_sha256, quote_source=snapshot.quote_source)
        if phase_transitions:
            result["scope"]["balance_curve_scope"] += "; phase balance resets excluded"
    result["provenance"].update(base)
    result.update(base)
    return result
