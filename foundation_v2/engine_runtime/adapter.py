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


def _quote_sides(midpoint, half_spread, tick):
    midpoint = Decimal(str(midpoint))
    bid = ((midpoint - half_spread) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick
    ask = ((midpoint + half_spread) / tick).to_integral_value(rounding=ROUND_CEILING) * tick
    if bid <= 0:
        raise ValueError("modeled quote is nonpositive")
    return bid, ask


def _protective_plans(bars, rules, protocol, *, tick, half_spread, units):
    if rules.get("exit_mode", "fixed_horizon") != "protective":
        return {}
    margin = protocol.get("parameters", {}).get("research_margin")
    if not isinstance(margin, dict) or margin.get("version") != "fixed-starting-balance-leverage-v1":
        raise ValueError("protective research requires fixed research margin assumptions")
    leverage = Decimal(str(margin["leverage"]))
    if not leverage.is_finite() or leverage <= 0:
        raise ValueError("research leverage must be positive")
    rate = Decimal(str(protocol["parameters"]["cost_model"].get("quote_to_account_rate", 1)))
    starting_balance = Decimal(str(protocol["starting_balance"]))
    stop_distance = Decimal(str(rules["stop_loss_distance_price"]))
    take_profit_distance = Decimal(str(rules["take_profit_distance_price"]))
    lookback, hold = int(rules["lookback"]), int(rules["hold_bars"])
    direction = rules.get("direction", "both")
    timeframe = int(protocol["dataset"]["timeframe_seconds"])
    plans = {}
    next_free_index = lookback
    for index in range(lookback, len(bars) - hold):
        prior = bars[index - lookback:index]
        close = Decimal(str(bars[index]["close"]))
        side = None
        if close > max(Decimal(str(row["high"])) for row in prior) and direction in {"long", "both"}:
            side = "BUY"
        elif close < min(Decimal(str(row["low"])) for row in prior) and direction in {"short", "both"}:
            side = "SELL"
        if side is None:
            continue
        if index < next_free_index:
            plans[index] = {"side": side, "action": "overlap"}
            continue
        entry_index = index + 1
        horizon_index = index + hold
        entry_bid, entry_ask = _quote_sides(bars[entry_index]["open"], half_spread, tick)
        entry_fill = entry_ask if side == "BUY" else entry_bid
        margin_required = entry_fill * units * rate / leverage
        if margin_required > starting_balance:
            plans[index] = {"side": side, "action": "margin", "margin_required": str(margin_required)}
            continue
        if side == "BUY":
            stop = ((entry_fill - stop_distance) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick
            take_profit = ((entry_fill + take_profit_distance) / tick).to_integral_value(rounding=ROUND_CEILING) * tick
        else:
            stop = ((entry_fill + stop_distance) / tick).to_integral_value(rounding=ROUND_CEILING) * tick
            take_profit = ((entry_fill - take_profit_distance) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick
        if stop <= 0 or take_profit <= 0:
            raise ValueError("protective levels must remain positive")
        outcome = None
        for exit_index in range(entry_index, horizon_index + 1):
            row = bars[exit_index]
            if exit_index > entry_index:
                open_bid, open_ask = _quote_sides(row["open"], half_spread, tick)
                if side == "BUY" and open_bid <= stop:
                    outcome = ("stop_loss_gap", open_bid, exit_index, int(row["timestamp"]))
                elif side == "BUY" and open_bid >= take_profit:
                    outcome = ("take_profit_gap", take_profit, exit_index, int(row["timestamp"]))
                elif side == "SELL" and open_ask >= stop:
                    outcome = ("stop_loss_gap", open_ask, exit_index, int(row["timestamp"]))
                elif side == "SELL" and open_ask <= take_profit:
                    outcome = ("take_profit_gap", take_profit, exit_index, int(row["timestamp"]))
                if outcome is not None:
                    break
            low_bid, low_ask = _quote_sides(row["low"], half_spread, tick)
            high_bid, high_ask = _quote_sides(row["high"], half_spread, tick)
            if side == "BUY":
                stop_hit, take_profit_hit = low_bid <= stop, high_bid >= take_profit
            else:
                stop_hit, take_profit_hit = high_ask >= stop, low_ask <= take_profit
            if stop_hit and take_profit_hit:
                raise ValueError("protective exit is intrabar ambiguous; lower-timeframe ordering required")
            if stop_hit:
                outcome = ("stop_loss", stop, exit_index, int(row["timestamp"]) + timeframe)
            elif take_profit_hit:
                outcome = ("take_profit", take_profit, exit_index, int(row["timestamp"]) + timeframe)
            if outcome is not None:
                break
        if outcome is None:
            exit_index = horizon_index
            exit_bid, exit_ask = _quote_sides(bars[exit_index]["close"], half_spread, tick)
            outcome = ("horizon", exit_bid if side == "BUY" else exit_ask, exit_index,
                       int(bars[exit_index]["timestamp"]) + timeframe)
        exit_reason, exit_price, actual_exit_index, close_time = outcome
        plans[index] = {
            "side": side,
            "action": "trade",
            "entry_index": entry_index,
            "exit_index": actual_exit_index,
            "exit_reason": exit_reason,
            "exit_price": str(exit_price),
            "close_time_utc": close_time,
            "stop": str(stop),
            "take_profit": str(take_profit),
            "margin_required": str(margin_required),
        }
        next_free_index = actual_exit_index
    return plans


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
    protective_mode = rules.get("exit_mode", "fixed_horizon") == "protective"
    protective_plans = _protective_plans(
        bars,
        rules,
        protocol,
        tick=tick,
        half_spread=half_spread,
        units=units,
    )
    events = {}
    quotes = []
    depth = instrument.make_qty(units * 100)

    def append_quote(kind, index, stamp, *, midpoint=None, bid=None, ask=None):
        if midpoint is not None:
            bid, ask = _quote_sides(midpoint, half_spread, tick)
        if bid is None or ask is None or bid <= 0 or ask < bid:
            raise ValueError("invalid modeled quote")
        events[stamp] = (kind, index)
        quotes.append(QuoteTick(instrument_id=instrument_id, bid_price=instrument.make_price(bid),
                                ask_price=instrument.make_price(ask), bid_size=depth, ask_size=depth,
                                ts_event=stamp, ts_init=stamp))

    for index, row in enumerate(bars):
        # Close at t precedes the next open at t+1ns. This is an explicit modeled
        # event sequence, not measured intrabar quotes or extra signal information.
        for kind, price, stamp in (
            ("open", row["open"], row["timestamp"] * 1_000_000_000 + 1),
            ("close", row["close"], (row["timestamp"] + timeframe) * 1_000_000_000),
        ):
            append_quote(kind, index, stamp, midpoint=price)
    if protective_mode:
        full_spread = half_spread * 2
        for plan in protective_plans.values():
            if plan.get("action") != "trade" or plan["exit_reason"] not in {"stop_loss", "take_profit"}:
                continue
            executable = Decimal(plan["exit_price"])
            stamp = int(plan["close_time_utc"]) * 1_000_000_000 - 1
            if plan["side"] == "BUY":
                bid = executable
                ask = ((executable + full_spread) / tick).to_integral_value(rounding=ROUND_CEILING) * tick
            else:
                ask = executable
                bid = ((executable - full_spread) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick
            append_quote("protective", int(plan["exit_index"]), stamp, bid=bid, ask=ask)
    quotes.sort(key=lambda quote: int(quote.ts_event))

    class BreakoutStrategy(Strategy):
        def __init__(self):
            super().__init__(StrategyConfig(log_events=False, log_commands=False))
            self.pending = None
            self.exit_index = -1
            self.active_side = None
            self.active_signal = None
            self.active_children = []
            self.active_plan = None
            self.order_context = {}
            self.fills = []
            self.rejections = []
            self.signals = {"long": 0, "short": 0, "no_signal": 0, "skipped_overlap": 0}
            if protective_mode:
                self.signals["skipped_margin"] = 0

        def on_start(self):
            self.subscribe_quote_ticks(instrument_id)

        def submit_leg(self, side, role, signal, index, **extra_context):
            order = self.order_factory.market(instrument_id=instrument_id,
                                              order_side=OrderSide.BUY if side == "BUY" else OrderSide.SELL,
                                              quantity=instrument.make_qty(units), time_in_force=TimeInForce.IOC,
                                              reduce_only=role == "exit")
            self.order_context[str(order.client_order_id)] = {
                "role": role, "signal_time_utc": signal, "bar_index": index, "order_type": "MARKET", **extra_context,
            }
            self.submit_order(order)

        def submit_bracket(self, side, signal, index, plan):
            order_list = self.order_factory.bracket(
                instrument_id=instrument_id,
                order_side=OrderSide.BUY if side == "BUY" else OrderSide.SELL,
                quantity=instrument.make_qty(units),
                time_in_force=TimeInForce.GTC,
                tp_price=instrument.make_price(Decimal(plan["take_profit"])),
                tp_post_only=False,
                sl_trigger_price=instrument.make_price(Decimal(plan["stop"])),
            )
            children = []
            for order in order_list.orders:
                tags = set(order.tags or [])
                context = {
                    "signal_time_utc": signal,
                    "bar_index": index,
                    "order_list_id": str(order_list.id),
                    "order_type": order.order_type.name,
                }
                if "ENTRY" in tags:
                    context.update({
                        "role": "entry",
                        "protective_stop_price": plan["stop"],
                        "protective_take_profit_price": plan["take_profit"],
                        "research_margin_required_account": plan["margin_required"],
                    })
                else:
                    children.append(order)
                    if "STOP_LOSS" in tags:
                        reason = "stop_loss_gap" if plan["exit_reason"] == "stop_loss_gap" else "stop_loss"
                    else:
                        reason = "take_profit_gap" if plan["exit_reason"] == "take_profit_gap" else "take_profit"
                    context.update({"role": "exit", "exit_reason": reason, "close_time_utc": plan["close_time_utc"]})
                self.order_context[str(order.client_order_id)] = context
            self.active_children = children
            self.submit_order_list(order_list)

        def on_quote_tick(self, quote):
            kind, index = events[int(quote.ts_event)]
            if kind == "open":
                if self.pending is not None:
                    if protective_mode:
                        side, signal, plan = self.pending
                    else:
                        side, signal = self.pending
                        plan = None
                    self.pending = None
                    if protective_mode and plan["action"] == "margin":
                        self.signals["skipped_margin"] += 1
                        return
                    self.active_side, self.active_signal = side, signal
                    if protective_mode:
                        self.active_plan = plan
                        self.exit_index = int(plan["exit_index"])
                        self.submit_bracket(side, signal, index, plan)
                    else:
                        self.exit_index = index + hold - 1
                        self.submit_leg(side, "entry", signal, index)
                return
            if kind == "protective":
                return
            if self.active_side is not None and index == self.exit_index:
                if protective_mode:
                    if self.active_plan["exit_reason"] == "horizon":
                        if self.active_children:
                            self.cancel_orders(self.active_children)
                        self.submit_leg(
                            "SELL" if self.active_side == "BUY" else "BUY",
                            "exit",
                            self.active_signal,
                            index,
                            exit_reason="horizon",
                            close_time_utc=self.active_plan["close_time_utc"],
                        )
                else:
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
                if protective_mode:
                    plan = protective_plans.get(index)
                    if plan is None or plan.get("side") != side:
                        raise ValueError("protective plan differs from closed-bar signal")
                    if plan["action"] == "overlap":
                        self.signals["skipped_overlap"] += 1
                    else:
                        self.pending = (side, (bars[index]["timestamp"] + timeframe), plan)
                else:
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
            if context["role"] == "exit":
                self.active_side = None
                self.active_children = []

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
                         reject_stop_orders=False, support_contingent_orders=True,
                         bar_execution=False, trade_execution=False)
        native.add_instrument(instrument)
        native.add_strategy(strategy)
        native.add_data(quotes)
        native.run()
        if strategy.rejections:
            raise ValueError(f"Nautilus rejected modeled orders: {strategy.rejections}")
        expected_fills = (
            sum(2 for plan in protective_plans.values() if plan.get("action") == "trade")
            if protective_mode else len(strategy.order_context)
        )
        if len(strategy.fills) != expected_fills:
            raise ValueError("Nautilus order/fill reconciliation incomplete")
        if len(strategy.fills) % 2 or native.cache.positions_open() or native.cache.orders_open():
            raise ValueError("Nautilus result has an unresolved position or order")
        return {"native_version": nautilus_trader.__version__, "adapter_version": ADAPTER_VERSION,
                "fills": strategy.fills, "signals": strategy.signals,
                "observed_range": {"from_utc": bars[0]["timestamp"], "to_utc": bars[-1]["timestamp"] + timeframe, "bar_count": len(bars)},
                "quote_model": (
                    "midpoint OHLC plus safe protective boundary ticks; dual-hit bars rejected; gap stops use executable open; TP limits use limit price"
                    if protective_mode else
                    "midpoint OHLC open/close only; close t before next open t+1ns; adverse ticks; unlimited modeled top-of-book size"
                )}
    finally:
        native.dispose()
