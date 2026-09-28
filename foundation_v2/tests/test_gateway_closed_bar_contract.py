from __future__ import annotations

from pathlib import Path


def _gateway_source() -> str:
    # The EA is owned by the parent MT5 project; this fixture is static-only
    # and never starts MetaTrader or opens the socket.
    path = Path(__file__).resolve().parents[2] / "MT5Gateway.mq5"
    return path.read_text(encoding="utf-8")


def test_gateway_rejects_unknown_timeframes_instead_of_falling_back_to_current() -> None:
    source = _gateway_source()
    assert "bool TryGetTimeframeEnum" in source
    assert "if(!TryGetTimeframeEnum(timeframe, tf))" in source
    assert "return PERIOD_CURRENT;" not in source


def test_gateway_bounds_history_request_before_copyrates() -> None:
    source = _gateway_source()
    assert "if(bars < 1 || bars > 100000)" in source


def test_gateway_marks_latest_tick_backed_row_as_provisional() -> None:
    source = _gateway_source()
    assert "bool provisional = (i == copied - 1);" in source
    assert '\\"closed\\"' in source
    assert '\\"provisional\\"' in source
