# GTAS → MT5 adaptation record

**Status:** recorded decision for the MT5 UI implementation  
**Date:** 2026-09-29  
**Source project:** [`D:/ANNAM/gtas_vpp`](D:/ANNAM/gtas_vpp) (read-only research)  
**Consumer contract:** [`DESIGN.md`](DESIGN.md)

This record separates what was observed in the historical GTAS/VPP project from
what is being carried into MT5. It prevents a visual reference from becoming a
blind copy or a hidden shared dependency.

## Evidence used

- [`VPP-PULSE-PRODUCT-BLUEPRINT.md`](D:/ANNAM/gtas_vpp/docs/design/VPP-PULSE-PRODUCT-BLUEPRINT.md): the three-layer presentation model and the
  `takeaway → evidence → context → drill-down → next action` data-story rule.
- [`VPP-PULSE-DESIGN-BRIEF.md`](D:/ANNAM/gtas_vpp/docs/design/VPP-PULSE-DESIGN-BRIEF.md): restrained OpenAI/Codex-inspired visual direction and
  page/workflow intent.
- [`VPP-PULSE-UI-UX-AI-TOOLCHAIN.md`](D:/ANNAM/gtas_vpp/docs/design/VPP-PULSE-UI-UX-AI-TOOLCHAIN.md): use of AI tools for exploration with
  runtime/code as the authority.
- [`VPP-UI-MOTIF-CATALOG.md`](D:/ANNAM/gtas_vpp/docs/design/VPP-UI-MOTIF-CATALOG.md): repeated shell, state, typography and motion motifs.
- [`AI-AGENT-OPERATING-MODEL.md`](D:/ANNAM/gtas_vpp/docs/ai/AI-AGENT-OPERATING-MODEL.md): source hierarchy, vertical slices and evidence-led
  agent workflow.
- The remote history in `D:/ANNAM/gtas_vpp` (898 commits), including focused
  waves such as `3c26ed0` (motion foundation), `08471b6` (workflow surfaces),
  `bb95726` (typed data surface), `0701b28` (workflow stepper), `4c11bd8`
  (header/page flattening), `305426d` (design-system loading primitives) and
  `e597e48` (centralized navigation metadata).

The source project is evidence for design reasoning. Its Blazor/Radzen runtime,
business vocabulary and assets are not dependencies of this project.

## Decision matrix

| GTAS observation | Decision for MT5 | How it changes for trading | Explicit rejection |
|---|---|---|---|
| Start with audience, question and decision, not chart type | **TAKE** | Start with the trader's next decision at a replay cutoff | No chart added only to fill a dashboard slot |
| Three layers: operational UI, role dashboard, report/data story | **ADAPT** | Chart/replay is operational; Analytics is summary plus ledger; source inspector is the audit layer | Do not reproduce office/procurement role dashboards |
| One main takeaway followed by evidence, context and drill-down | **TAKE** | Context includes instrument, timeframe, mode, cutoff and data quality | No narrative conclusion when data is missing or future rows are hidden |
| Progressive disclosure: summary → exact rows → inspector | **TAKE** | Metric/equity curve leads to trade ledger, candle details and provenance | Do not hide required risk/mode warnings behind a drawer |
| Stable toolbar/action surface across loading, empty and error | **TAKE** | Replay controls remain predictable while data/status changes | No dead retry or fake action just to keep a button visible |
| Flat-first shell, compact type, neutral surfaces, one primary action | **ADAPT** | Chart gets the visual weight; risk/journal sit in context panels | No wholesale token or pixel clone of GTAS |
| Typed primitives before composites and route patterns | **TAKE** | Keep context, metric, chart, source and state contracts explicit | No universal page abstraction before two real route consumers |
| Motion foundation and repeated runtime refinement | **ADAPT** | Motion explains cursor/time, selection and status changes | No decorative autoplay, number theatrics or reduced-motion breakage |
| Browser runtime is visual authority; generated/Figma output is reference | **TAKE** | Playwright/browser checks own layout and interaction acceptance | Screenshot-only or Figma-only approval is insufficient |
| Design tokens and CSS ownership | **ADAPT** | Consume project snapshot and semantic trading roles | Do not import `vpp-tokens.css` or Radzen bridge files |
| Data surface carries status, source and exact table | **TAKE** | Add hash, cutoff, revision, cost basis and no-future-leak evidence | No unlabelled live/holdout or derived metric |
| Product-specific shell/navigation metadata | **ADAPT** | Use `FxReplayShell` and trading routes already in the codebase | Do not copy GTAS route names or IA |
| Atlas/Figma and image references used to explore alternatives | **TAKE** | Keep runnable candidate and route fixture as proof | Do not treat an image as a production component |
| Branded imagery, PPJ/denim motif, office roles and Radzen controls | **REJECT** | They do not communicate replay/risk/provenance | Never add them for visual novelty |

## MT5 acceptance consequences

The adaptation is considered applied only when a runnable slice proves all of the
following:

1. the chart and replay cutoff are the first readable evidence;
2. the shell preserves instrument/timeframe/mode and broker lock;
3. a takeaway can be traced to visible chart/table evidence;
4. the user can drill into exact rows and provenance without leaving context;
5. the next action is real, bounded and safe for the current capability;
6. loading/empty/stale/error/denied/unknown/conflict states remain truthful;
7. motion improves temporal or interaction comprehension and respects reduced
   motion;
8. a report or draft never turns into an implied broker order or holdout read.

These are implementation targets, not a claim that every current route already
passes them. Route-level evidence remains in the project test/evidence files.

## Deferred decisions

- exact final theme family and dark-mode palette;
- promotion of any project component into the shared trading UI layer;
- Figma/Make round-trip and any external design-tool integration;
- live broker execution and holdout access;
- additional chart renderer or licensed Advanced Charts migration.

Each deferred item has a separate authority and validation gate. This document
does not unlock it implicitly.
