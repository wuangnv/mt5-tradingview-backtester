# Center library button contents — 08/10/2026

The previous spacing change also left-aligned the icon/text inside the fixed
116px action button. This made its hover pill visibly asymmetric. Column/group
alignment and the button's internal alignment are separate concerns.

Changed only `justify-content` for Download/Pause/Resume back to `center` and
clarified that distinction in the project UI contract. Status remains 112px,
Actions 196px, and buttons keep their existing size, slot, gap, hover/focus,
disabled rules, progress and callbacks.

Validation:

- Production build and diff check: PASS.
- Parent actual GET-only Download hover: icon plus text Range union is exactly
  centered; left/right space both 27.78125px, horizontal delta 0. Results in
  `geometry.json`; parent visually inspected `hover-dark.png`.
- Independent focused browser review/checks: 10/10 PASS; `independent/REVIEW.md`, `qa.mjs`
  and `results.json`. Actual requests remain GET-only, with live routes,
  WebSockets, external origins and mutations blocked.

No change to table column spacing, user data or backend services. The icon's
position within its button naturally follows the centered content group.
