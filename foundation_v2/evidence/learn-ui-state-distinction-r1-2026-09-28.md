# Learn UI state distinction — R1 (2026-09-28)

This receipt covers a small offline UI hardening change. The Learn workspace
now preserves `unavailable` as its own presentation state instead of mapping
it to `empty` for overview, resource and glossary branches.

## Scope

- `404 learn_not_configured` remains `status=unavailable`;
- `empty` remains reserved for a valid source that returned no content/items;
- the unavailable state gets its own visual class and remains text-labelled;
- no data, permission, provider, broker or execution behavior changed.

This aligns the consumer with the shared candidate contract in
`D:/ANNAM/UI-Systems/core/contracts/presentation-state/1.0.0/` while keeping
the domain-specific Learn API unchanged.

## Validation

```text
npm run test:learn-ui
PASS
  loading, course progress, glossary/resource states, denied, unavailable,
  error, unsafe contract, read-only requests, context round trips,
  responsive 1440/768/360
  unavailable class is present and empty class is absent

npm run build
PASS
  vite v7.3.6; 37 modules transformed

git diff --check
PASS
```

## Acceptance

`PREP_ONLY` for UI integration. The focused fixture proves the state class and
runtime branch; whole-product visual acceptance and shared-token migration
remain open. Rollback is the single commit revert and leaves the prior empty
mapping intact.
