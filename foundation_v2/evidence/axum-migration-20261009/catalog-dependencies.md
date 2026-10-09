Native persisted Prop reads reuse schemas exported from the canonical Pydantic
models instead of maintaining a second hand-written field contract. Export with
`api-rust/tests/export_prop_schemas.py`; `--check` verifies freshness. The IANA
timezone list is exported from the installed Python timezone database.

Dependency review on 2026-10-09:

| Dependency | Pin | License | Primary source | Runtime scope |
|---|---|---|---|---|
| jsonschema | 0.58.6 | MIT | https://github.com/Stranger6667/jsonschema ; https://docs.rs/jsonschema/0.58.6 | Local, reusable validators. Default features disabled: no HTTP/file schema resolver, TLS client or external schema retrieval. |
| bigdecimal | 0.4.10 | MIT/Apache-2.0 | https://github.com/akubera/bigdecimal-rs ; https://docs.rs/bigdecimal/0.4.10 | Arbitrary precision parse and equality invariant; no broker/rules/profit evaluation. |

Package identity, license and declared features were checked with `cargo info`.
jsonschema declares Rust >=1.85; installed Rust 1.98 builds and smoke-tests it.
Both are exact pins with resolved transitive packages in Cargo.lock. No service,
OAuth, account, secret, paid API or global configuration is introduced. This is
not a full transitive security audit. Rollback removes validator code, generated
contracts and these dependency entries, then regenerates the lockfile.

Stored snapshot guards check the generated field constraints and model-level
consistency: row identity, phase sequence/currency, threshold exclusivity,
drawdown declaration, named-provider provenance, valid IANA reset timezone,
aware virtual times, ordered attempt interval, and equity equals balance plus
floating P/L. Missing fields with declared defaults are populated; required
fields, unknown fields, invalid enums/types and non-finite monetary strings are
rejected with `503 stored_contract_untrusted`.

Two schema details require explicit alignment with Pydantic: its Decimal regex
does not include exponent syntax that its actual validator accepts, so monetary
strings are checked by BigDecimal instead; reset-local-time accepts naive time,
so a custom `time` format permits the model's local time representation. Virtual
timestamps still require an offset.
