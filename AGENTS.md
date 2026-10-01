# MT5 TradingView Backtester

Parent workspace instructions in `D:\ANNAM\TradingWorkspace\AGENTS.md` apply.

## Authoritative context

- Start/run instructions: `README.md`; current product source is `foundation_v2/`.
- Product completion plan: `D:\ANNAM\TradingWorkspace\planning\mt5-tradingview-backtester\PRODUCT-COMPLETION-PLAN.md`
- Start/resume and state ownership: `EXECUTION-ENTRYPOINT.md` beside that plan, then its current ledger/receipts. Generated `STATE.json` and narrative `RESUME.md` do not replace the ledger.
- UI scope/quality: `D:\ANNAM\TradingWorkspace\planning\mt5-tradingview-backtester\WMREPLAY-UI-MASTER-PLAN.md`
- Project UI contract/config: `ui/`

U1 checkpoints and old design/exploration prompts are historical references. Open them only for relevant decisions or regressions; do not restart accepted work from an old status snapshot.

## Current UI gate

The owner delegated UI direction and acceptance to agents. Continue the chosen WMREPLAY direction with independent review + runnable visual/interaction QA; do not wait for owner aesthetic approval or treat implementation/build success as accepted UI. Product Plan owns scope; WMREPLAY owns its UI quality contract. Broker/data/cost/deploy gates remain separate.

The owner retired `projects/mt5-tradingview-backtester-figma-make` and `projects/mt5-tradingview-backtester-gemini-sketch` on 01/10/2026. Do not use or recreate these checkouts as a prerequisite for product work. New design exploration requires an explicit task; ordinary UI work stays in the main repo.

## UI worker preparation

Use `.agents/skills/trading-ui-qa/SKILL.md` for web UI QA. Playwright scripts/CLI are the default, selective screenshots/traces cover visual/canvas checks, and computer use is a scoped fallback for gaps. The parent workspace's `tooling/ui-qa/qa.mjs doctor --plan <canonical-product-plan>` checks the handoff; it never starts the product or marks acceptance. Product Plan is the single user handoff. Tooling fixture PASS is not product/Figma/broker PASS.

## Shared UI layers

- Global foundations: `D:\ANNAM\UI-Systems`
- Trading-domain contracts: `D:\ANNAM\TradingWorkspace\UI`
- Project-specific UI: `ui/`

The project may consume shared contracts but should not copy or mutate shared global files as a side effect of an ordinary feature task.

## Implementation rules

- Follow owner-approved PATH-2 (`planning/mt5-tradingview-backtester/FOUNDATION-ADR-0001-PATH2.md` in the parent workspace). Reuse clean domain logic/tests; legacy Flask is reference, not a constraint to restore. Do not reopen the chosen stack without the ADR's revisit evidence.
- Reuse current routes, stores, contracts, and chart capabilities before adding new frontend frameworks.
- Preserve Vietnamese-first UI and explicit units/scope/state semantics.
- Visual changes require browser/screenshot QA at representative widths and must test error/empty/stale/unknown states where relevant.
- Generated code must be reviewed against the actual repository; do not paste a generator's preferred framework wholesale.

## Safety gates

- Never enable live broker execution without explicit user permission.
- Do not open holdout data without the approved protocol/user gate.
- Do not add paid providers, OAuth integrations, deploy/restart active terminals, delete user data, or public-release the app without the required user approval.
- UI must never imply that a planned/replay order was sent to a broker.

## Dirty worktree

The repository may contain active user/project-completion changes. Never revert unrelated modifications. Work with existing changes and keep UI-system work scoped.

