# Chart visible-range adapter — offline contract

Status: **PREP_ONLY**, 27/09/2026. This receipt records a typed seam for a
future browser chart callback; it does not claim that a browser or chart SDK
was connected.

`VisibleRangeRequest` binds a request ID, source identity, replay cutoff,
indicator definition hash and inclusive UTC viewport. `adapt_visible_range`
validates the complete canonical overlay packet before comparing that scope.
An optimistic renderer generation can be supplied to reject a stale browser
callback before it produces any operations. Successful requests reuse the
existing bounded renderer plan, including its object/visible caps, lifecycle,
stale cleanup and tombstones. Rejected requests have no render plan.

The contract is deliberately local and provider-free. It imports only the
canonical overlay and renderer contracts, and the request parser rejects
unknown fields such as provider metadata. No browser SDK, network, AI
provider, persistence, MT5 terminal, broker, or order route is called.

Validation: `6 passed` in the focused adapter test; compileall and diff checks
passed. Tests cover successful source/cutoff binding, generation conflict,
scope mismatch, strict payload parsing and deterministic response shape.

The next gate is adapter-specific visual/interaction QA against a selected
chart implementation. This receipt does not provide that external evidence.
