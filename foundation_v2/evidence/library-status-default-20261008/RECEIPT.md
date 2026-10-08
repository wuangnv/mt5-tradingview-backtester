# Library status default and empty placement — 08/10/2026

Owner request: default to downloaded assets, reorder/reposition the status menu,
place the empty result below the table header, and assess the observed download pace.

- `DataDeskWorkspace` initializes `downloadFilter` to `downloaded`. Order is
  Đã tải → Đang tải → Chưa tải → Tất cả trạng thái. Clear filters still removes
  every filter; reload starts with the requested default.
- Reuses `FxSelect`; the status menu starts at the trigger's left edge, with the
  existing viewport clamp on narrow screens. Other pages/components are unchanged.
- Empty content is inside the table scroll region immediately after the table.
  Its text shares the first column gutter; no extra border/surface was added.
- Existing library model tests: 8 pass. Production Vite build passes.
- `node foundation_v2/evidence/library-status-default-20261008/qa.mjs` passes
  fixtures at 1710/768/360 px: default, order, keyboard, filter, clear, reload,
  empty placement/inset and overflow. Screenshots reviewed. All writes intercepted.
- Actual local UI/API verified GET-only, with no source probes or download actions.
  Earlier samples during this task advanced by 1–2 history days over 12 seconds;
  byte throughput was small enough to round to zero MiB/s. This is slow and does
  not measure the user's maximum Internet bandwidth. Historical day sizes vary.
- Latest persisted sample in `qa.json`: paused with `source_rate_limited`,
  1425/8558 days, 29,903,579 transferred bytes, cooldown decreasing from 2366 to
  2354 seconds. No real full-download completion or throughput improvement claimed.

Scope: frontend filter/layout only. Backend/provider behaviour was not modified.
