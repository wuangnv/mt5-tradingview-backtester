"""Deterministic bid/ask cost accounting for U2 fixtures and later engines."""

from decimal import Decimal, ROUND_HALF_UP

from data_contracts import CostModel, DataContractError, require_decimal


def _money(value, decimals):
    quantum = Decimal(1).scaleb(-decimals)
    return value.quantize(quantum, rounding=ROUND_HALF_UP)


def calculate_round_trip_cost(
    model,
    side,
    quantity,
    contract_size,
    entry_bid,
    entry_ask,
    exit_bid,
    exit_ask,
):
    if not isinstance(model, CostModel):
        model = CostModel.from_mapping(model)
    side = str(side or "").upper()
    if side not in {"BUY", "SELL"}:
        raise DataContractError("side must be BUY or SELL")

    quantity = require_decimal(quantity, "quantity", strictly_positive=True)
    contract_size = require_decimal(contract_size, "contract_size", strictly_positive=True)
    entry_bid = require_decimal(entry_bid, "entry_bid", strictly_positive=True)
    entry_ask = require_decimal(entry_ask, "entry_ask", strictly_positive=True)
    exit_bid = require_decimal(exit_bid, "exit_bid", strictly_positive=True)
    exit_ask = require_decimal(exit_ask, "exit_ask", strictly_positive=True)
    if entry_ask < entry_bid or exit_ask < exit_bid:
        raise DataContractError("ask must be >= bid")

    units = quantity * contract_size
    if side == "BUY":
        gross_quote = (exit_bid - entry_ask) * units
        entry_fill = entry_ask
        exit_fill = exit_bid
    else:
        gross_quote = (entry_bid - exit_ask) * units
        entry_fill = entry_bid
        exit_fill = exit_ask

    gross_account = gross_quote * model.quote_to_account_rate
    slippage_account = (
        model.slippage_price_per_side * Decimal(2) * units * model.quote_to_account_rate
    )
    commission_account = max(
        model.commission_per_side_account * Decimal(2),
        model.minimum_fee_account,
    )
    explicit_cost_account = commission_account + slippage_account + model.financing_account
    net_account = gross_account - explicit_cost_account

    return {
        "cost_model_version": model.version,
        "spread_basis": model.spread_basis,
        "side": side,
        "entry_fill": float(entry_fill),
        "exit_fill": float(exit_fill),
        "gross_quote": float(gross_quote),
        "gross_account": float(_money(gross_account, model.rounding_decimals)),
        "spread_cost_account": 0.0,
        "commission_account": float(_money(commission_account, model.rounding_decimals)),
        "slippage_account": float(_money(slippage_account, model.rounding_decimals)),
        "financing_account": float(_money(model.financing_account, model.rounding_decimals)),
        "net_account": float(_money(net_account, model.rounding_decimals)),
        "account_ccy": model.account_ccy,
        "quote_to_account_rate": float(model.quote_to_account_rate),
        "rounding_decimals": model.rounding_decimals,
    }

