"""Validated U2 data contracts shared by data, news and cost workflows."""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation


class DataContractError(ValueError):
    pass


def require_text(value, name):
    text = str(value or "").strip()
    if not text:
        raise DataContractError(f"{name} is required")
    return text


def require_decimal(value, name, minimum=None, strictly_positive=False):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise DataContractError(f"{name} must be numeric") from exc
    if not number.is_finite():
        raise DataContractError(f"{name} must be finite")
    if strictly_positive and number <= 0:
        raise DataContractError(f"{name} must be positive")
    if minimum is not None and number < Decimal(str(minimum)):
        raise DataContractError(f"{name} must be >= {minimum}")
    return number


@dataclass(frozen=True)
class SourceSpec:
    source_id: str
    provider: str
    instrument_mapping: dict
    license_use: str
    retrieved_at_utc: str
    export_settings: str

    @classmethod
    def from_mapping(cls, value):
        value = value or {}
        instrument_mapping = value.get("instrument_mapping")
        if not isinstance(instrument_mapping, dict) or not instrument_mapping:
            raise DataContractError("instrument_mapping must be a non-empty object")
        return cls(
            source_id=require_text(value.get("source_id"), "source_id"),
            provider=require_text(value.get("provider"), "provider"),
            instrument_mapping={str(key): str(mapped) for key, mapped in instrument_mapping.items()},
            license_use=require_text(value.get("license_use"), "license_use"),
            retrieved_at_utc=require_text(value.get("retrieved_at_utc"), "retrieved_at_utc"),
            export_settings=require_text(value.get("export_settings"), "export_settings"),
        )


@dataclass(frozen=True)
class InstrumentSpec:
    instrument_id: str
    asset_class: str
    base_ccy: str
    quote_ccy: str
    account_ccy: str
    tick_size: Decimal
    pip_size: Decimal
    contract_size: Decimal
    quantity_min: Decimal
    quantity_step: Decimal
    effective_from_utc: str
    effective_to_utc: str

    @classmethod
    def from_mapping(cls, value):
        value = value or {}
        return cls(
            instrument_id=require_text(value.get("instrument_id"), "instrument_id"),
            asset_class=require_text(value.get("asset_class"), "asset_class"),
            base_ccy=require_text(value.get("base_ccy"), "base_ccy").upper(),
            quote_ccy=require_text(value.get("quote_ccy"), "quote_ccy").upper(),
            account_ccy=require_text(value.get("account_ccy"), "account_ccy").upper(),
            tick_size=require_decimal(value.get("tick_size"), "tick_size", strictly_positive=True),
            pip_size=require_decimal(value.get("pip_size"), "pip_size", strictly_positive=True),
            contract_size=require_decimal(value.get("contract_size"), "contract_size", strictly_positive=True),
            quantity_min=require_decimal(value.get("quantity_min"), "quantity_min", strictly_positive=True),
            quantity_step=require_decimal(value.get("quantity_step"), "quantity_step", strictly_positive=True),
            effective_from_utc=require_text(value.get("effective_from_utc"), "effective_from_utc"),
            effective_to_utc=str(value.get("effective_to_utc") or "").strip(),
        )


@dataclass(frozen=True)
class CostModel:
    version: str
    spread_basis: str
    commission_per_side_account: Decimal
    minimum_fee_account: Decimal
    slippage_price_per_side: Decimal
    financing_account: Decimal
    quote_to_account_rate: Decimal
    account_ccy: str
    rounding_decimals: int

    @classmethod
    def from_mapping(cls, value):
        value = value or {}
        basis = require_text(value.get("spread_basis"), "spread_basis")
        if basis != "bid_ask_embedded":
            raise DataContractError("spread_basis must be bid_ask_embedded")
        try:
            rounding_decimals = int(value.get("rounding_decimals", 2))
        except (TypeError, ValueError) as exc:
            raise DataContractError("rounding_decimals must be an integer") from exc
        if rounding_decimals < 0 or rounding_decimals > 8:
            raise DataContractError("rounding_decimals must be between 0 and 8")
        return cls(
            version=require_text(value.get("version"), "version"),
            spread_basis=basis,
            commission_per_side_account=require_decimal(
                value.get("commission_per_side_account", 0),
                "commission_per_side_account",
                minimum=0,
            ),
            minimum_fee_account=require_decimal(
                value.get("minimum_fee_account", 0),
                "minimum_fee_account",
                minimum=0,
            ),
            slippage_price_per_side=require_decimal(
                value.get("slippage_price_per_side", 0),
                "slippage_price_per_side",
                minimum=0,
            ),
            financing_account=require_decimal(value.get("financing_account", 0), "financing_account"),
            quote_to_account_rate=require_decimal(
                value.get("quote_to_account_rate", 1),
                "quote_to_account_rate",
                strictly_positive=True,
            ),
            account_ccy=require_text(value.get("account_ccy"), "account_ccy").upper(),
            rounding_decimals=rounding_decimals,
        )


@dataclass(frozen=True)
class NewsEvent:
    event_id: str
    currency: str
    scheduled_time_utc: int
    known_at_utc: int
    event_type: str
    impact_source: str
    time_precision: str
    revision_source: str

    @classmethod
    def from_mapping(cls, value):
        value = value or {}
        try:
            scheduled = int(value.get("scheduled_time_utc"))
        except (TypeError, ValueError) as exc:
            raise DataContractError("scheduled_time_utc must be unix seconds") from exc
        known_raw = value.get("known_at_utc")
        if known_raw in (None, ""):
            known = None
        else:
            try:
                known = int(known_raw)
            except (TypeError, ValueError) as exc:
                raise DataContractError("known_at_utc must be unix seconds") from exc
        return cls(
            event_id=require_text(value.get("event_id"), "event_id"),
            currency=require_text(value.get("currency"), "currency").upper(),
            scheduled_time_utc=scheduled,
            known_at_utc=known,
            event_type=require_text(value.get("event_type"), "event_type"),
            impact_source=require_text(value.get("impact_source"), "impact_source"),
            time_precision=require_text(value.get("time_precision"), "time_precision"),
            revision_source=require_text(value.get("revision_source"), "revision_source"),
        )
