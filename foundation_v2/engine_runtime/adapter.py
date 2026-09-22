"""Offline Nautilus execution adapter; no live client or broker configuration."""

from __future__ import annotations

from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR

import nautilus_trader
from nautilus_trader.backtest.config import BacktestEngineConfig
from nautilus_trader.backtest.engine import BacktestEngine
from nautilus_trader.backtest.models import FillModel
from nautilus_trader.common.config import LoggingConfig
from nautilus_trader.model.data import QuoteTick
from nautilus_trader.model.enums import AccountType, OmsType, OrderSide, TimeInForce
from nautilus_trader.model.identifiers import InstrumentId, Symbol, Venue
from nautilus_trader.model.instruments import CurrencyPair
from nautilus_trader.model.objects import Currency, Money, Price, Quantity
from nautilus_trader.trading.config import StrategyConfig
from nautilus_trader.trading.strategy import Strategy


NATIVE_VERSION = "1.231.0"
ADAPTER_VERSION = "nautilus-breakout-v1"


def _precision(value):
    return max(0, -Decimal(str(value)).normalize().as_tuple().exponent)


def execute_nautilus(rows: list[dict], protocol: dict) -> dict:
    if nautilus_trader.__version__ != NATIVE_VERSION:
        raise ValueError("Nautilus runtime version differs from pinned adapter")
    spec = protocol["dataset"]["instrument_spec"]
    if spec["asset_class"] != "fx" or spec["account_ccy"] != spec["quote_ccy"]:
        raise ValueError("Nautilus FX adapter requires account currency equal to quote currency")
    rules = protocol["playbook"]["rules"]
    lookback, hold = int(rules["lookback"]), int(rules["hold_bars"])
    timeframe = int(protocol["dataset"]["timeframe_seconds"])
    start, end = protocol["range"]["from_utc"], protocol["range"]["to_utc"]
    bars = [row for row in rows if start <= row["timestamp"] and row["timestamp"] + timeframe <= end]
    if len(bars) < lookback + hold + 1:
        raise ValueError("dataset range is too short for playbook rules")
    if any(b["timestamp"] - a["timestamp"] < timeframe for a, b in zip(bars, bars[1:])):
        raise ValueError("bars overlap the declared timeframe")
    tick = Decimal(str(spec["tick_size"]))
    contract_size = Decimal(str(spec["contract_size"]))
    quantity = Decimal(str(rules["quantity"]))
    unit_step = Decimal(str(spec["quantity_step"])) * contract_size
    unit_min = Decimal(str(spec["quantity_min"])) * contract_size
    units = quantity * contract_size
    if units < unit_min or units % unit_step:
        raise ValueError("strategy quantity violates instrument minimum/step")
    half_spread = Decimal(str(protocol["parameters"]["spread_price"])) / 2
    instrument_id = InstrumentId.from_str(f"{spec['instrument_id']}.RESEARCH")
    instrument = CurrencyPair(
        instrument_id=instrument_id, raw_symbol=Symbol(spec["instrument_id"]),
        base_currency=Currency.from_str(spec["base_ccy"]), quote_currency=Currency.from_str(spec["quote_ccy"]),
        price_precision=_precision(tick), size_precision=_precision(unit_step),
        price_increment=Price.from_str(f"{tick:.{_precision(tick)}f}"),
        size_increment=Quantity.from_str(f"{unit_step:.{_precision(unit_step)}f}"),
        min_quantity=Quantity.from_str(f"{unit_min:.{_precision(unit_step)}f}"), ts_event=0, ts_init=0,
    )
    events = {}
    quotes = []
    depth = instrument.make_qty(units * 100)
    for index, row in enumerate(bars):
        # Close at t precedes the next open at t+1ns. This is an explicit modeled
        # event sequence, not measured intrabar quotes or extra signal information.
        for kind, price, stamp in (
            ("open", row["open"], row["timestamp"] * 1_000_000_000 + 1),
            ("close", row["close"], (row["timestamp"] + timeframe) * 1_000_000_000),
        ):
            midpoint = Decimal(str(price))
            bid = ((midpoint - half_spread) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick
            ask = ((midpoint + half_spread) / tick).to_integral_value(rounding=ROUND_CEILING) * tick
            if bid <= 0:
                raise ValueError("modeled quote is nonpositive")
            events[stamp] = (kind, index)
            quotes.append(QuoteTick(instrument_id=instrument_id, bid_price=instrument.make_price(bid),
                                    ask_price=instrument.make_price(ask), bid_size=depth, ask_size=depth,
                                    ts_event=stamp, ts_init=stamp))

    class BreakoutStrategy(Strategy):
        def __init__(self):
            super().__init__(StrategyConfig(log_events=False, log_commands=False))
            self.pending = None
            self.exit_index = -1
            self.active_side = None
            self.active_signal = None
            self.order_context = {}
            self.fills = []
            self.rejections = []
            self.signals = {"long": 0, "short": 0, "no_signal": 0, "skipped_overlap": 0}

        def on_start(self):
            self.subscribe_quote_ticks(instrument_id)

        def submit_leg(self, side, role, signal, index):
            order = self.order_factory.market(instrument_id=instrument_id,
                                              order_side=OrderSide.BUY if side == "BUY" else OrderSide.SELL,
                                              quantity=instrument.make_qty(units), time_in_force=TimeInForce.IOC,
                                              reduce_only=role == "exit")
            self.order_context[str(order.client_order_id)] = {"role": role, "signal_time_utc": signal, "bar_index": index}
            self.submit_order(order)

        def on_quote_tick(self, quote):
            kind, index = events[int(quote.ts_event)]
            if kind == "open":
                if self.pending is not None:
                    side, signal = self.pending
                    self.pending = None
                    self.active_side, self.active_signal = side, signal
                    self.exit_index = index + hold - 1
                    self.submit_leg(side, "entry", signal, index)
                return
            if self.active_side is not None and index == self.exit_index:
                self.submit_leg("SELL" if self.active_side == "BUY" else "BUY", "exit", self.active_signal, index)
                self.active_side = None
            if index < lookback or index >= len(bars) - hold:
                return
            prior = bars[index - lookback:index]
            close = Decimal(str(bars[index]["close"]))
            side = None
            if close > max(Decimal(str(row["high"])) for row in prior) and rules.get("direction", "both") in {"long", "both"}:
                side = "BUY"
                self.signals["long"] += 1
            elif close < min(Decimal(str(row["low"])) for row in prior) and rules.get("direction", "both") in {"short", "both"}:
                side = "SELL"
                self.signals["short"] += 1
            else:
                self.signals["no_signal"] += 1
            if side is not None:
                if index < self.exit_index:
                    self.signals["skipped_overlap"] += 1
                else:
                    self.pending = (side, (bars[index]["timestamp"] + timeframe))

        def on_order_filled(self, event):
            context = self.order_context[str(event.client_order_id)]
            self.fills.append({**context, "client_order_id": str(event.client_order_id),
                               "native_trade_id": str(event.trade_id), "side": event.order_side.name,
                               "units": str(event.last_qty), "price": str(event.last_px),
                               "timestamp_ns": int(event.ts_event)})

        def on_order_rejected(self, event):
            self.rejections.append({"client_order_id": str(event.client_order_id), "reason": str(event.reason)})

        def on_order_denied(self, event):
            self.rejections.append({"client_order_id": str(event.client_order_id), "reason": str(event.reason)})

    native = BacktestEngine(config=BacktestEngineConfig(logging=LoggingConfig(bypass_logging=True), run_analysis=False))
    strategy = BreakoutStrategy()
    try:
        native.add_venue(venue=Venue("RESEARCH"), oms_type=OmsType.NETTING, account_type=AccountType.MARGIN,
                         starting_balances=[Money(protocol["starting_balance"], instrument.quote_currency)],
                         base_currency=instrument.quote_currency, fill_model=FillModel(prob_slippage=0, random_seed=int(protocol.get("seed", 0))),
                         bar_execution=False, trade_execution=False)
        native.add_instrument(instrument)
        native.add_strategy(strategy)
        native.add_data(quotes)
        native.run()
        if strategy.rejections:
            raise ValueError(f"Nautilus rejected modeled orders: {strategy.rejections}")
        if len(strategy.fills) != len(strategy.order_context):
            raise ValueError("Nautilus order/fill reconciliation incomplete")
        if len(strategy.fills) % 2 or native.cache.positions_open():
            raise ValueError("Nautilus result has an unresolved position")
        return {"native_version": nautilus_trader.__version__, "adapter_version": ADAPTER_VERSION,
                "fills": strategy.fills, "signals": strategy.signals,
                "observed_range": {"from_utc": bars[0]["timestamp"], "to_utc": bars[-1]["timestamp"] + timeframe, "bar_count": len(bars)},
                "quote_model": "midpoint OHLC open/close only; close t before next open t+1ns; adverse ticks; unlimited modeled top-of-book size"}
    finally:
        native.dispose()
