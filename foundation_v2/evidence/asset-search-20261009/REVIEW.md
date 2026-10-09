# Asset dropdown search — 09/10/2026

Removed asset-specific boxed search styling. Shared dropdown search now owns the
underline boundary; generic compact form geometry excludes direct menu inputs.
Blue remains the existing design-system focus token, not a new asset-specific color.

Actual local browser checks passed at 1710px and 1440px, dark and light: settled
focus style, normal form geometry retained, search/clear, arrow navigation and
Escape returning focus. Real read APIs were used; no forms submitted or write
requests made. See `receipt.json` and screenshots. Probe source remains in
`web/.runtime/asset-search/probe.mjs` as local diagnostic tooling.

Independent frontend review found no material issue in the three changed CSS
files or screenshots; it checked shared selector scope and normal form ownership.
