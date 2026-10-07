# Project palette

Owner-approved neutral black/white surfaces and stronger peach, blue and green accents apply to every MT5 web workspace and application
controls. The trading chart uses the Legacy black palette selected on
07/10/2026; report charts retain the stronger report palette below. Continue the
existing flat layout, sizes and navigation.
This is a project contract, not a change to the pinned shared UI foundation.

`foundation_v2/web/public/project-palette.css` owns both theme values. The HTML
loads it before the application. `component-interactions.css` maps project colors
to existing shell, WM, FX and UI roles. Trading chart engines use
`nativeChartPalette.js`; `chart-legacy.css` adapts toolbar chrome using documented CSS roles without editing vendor sources.
Theme changes repaint series, volume and overlays. Saved trading layouts cannot
restore the earlier pastel chart palette.

| Role | Dark | Light | Usage |
| --- | --- | --- | --- |
| Canvas | `#080808` | `#FFFFFF` | Main page |
| Chrome | `#0C0C0C` | `#FFFFFF` | Rail |
| Surface | `#141414` | `#FFFFFF` | Data groups |
| Raised | `#1D1D1D` | `#FAFAFA` | Menus and overlays |
| Control | `#232323` | `#F4F4F4` | Secondary actions |
| Hover | `#2A2A2A` | `#EBEBEB` | Interactive surface |
| Text | `#FFFFFF` | `#111111` | Content and selected navigation |
| Muted | `#B8B8B8` | `#525252` | Metadata |
| Sea blue | `#7ABBE6` | `#24658B` | Progress, secondary accents and keyboard focus |
| On primary | `#080808` | `#FFFFFF` | Text on filled actions |
| Highlight | `#FFAD7C` | `#A44715` | Parent tab with source tabs, quick-action icons, session counts, draft drawings |
| Positive | `#72CFA1` | `#24724B` | Gains, success, target |
| Negative | `#FF828B` | `#B5373C` | Loss, errors, stop |
| Warning | `#EAC369` | `#845D0D` | Caution and unavailable state |

Use colors by role rather than by page. Keep accents sparse: controls and labels
remain neutral unless an action or data meaning needs emphasis. Header navigation
hover only brightens text/icons; no hover fill or pointer border. Selected tabs
retain the white/dark underline. A selected parent with source tabs uses peach
text/icon and a continuous peach underline across the parent and source tabs;
source-tab text stays neutral. Dropdown selection uses a checkmark,
not a persistent hover fill. Financial colors retain their distinct meanings.

Never recolor user-defined drawings, change financial data, or substitute demo
data for a failed actual read. Demo, empty, unavailable and loading keep their
existing data/state ownership. Contrast checks cover content/metadata against
surfaces and primary/semantic action foregrounds in both themes.

## Primary actions and related badges

| Role | Dark | Light |
| --- | --- | --- |
| Action / hover | `#FFAD7C` / `#FFC49F` | `#B85018` / `#993E10` |
| On action | `#080808` | `#FFFFFF` |
| Peach soft / text | `#3B2418` / `#FFC49F` | `#FFE5D5` / `#9A3E15` |
| Delete / hover | `#C53E48` / `#CC414B` | `#B5373C` / `#98292F` |
| On delete | `#FFFFFF` | `#FFFFFF` |

`--project-action` maps to `--wm-action-bg`, with matching hover and foreground.
Use filled peach for New session, Go to chart, Apply, and primary submit actions.
Secondary actions remain neutral. Remaining-days badges use soft peach. Dashboard
remaining-days progress uses sea blue for contrast with peach actions. Destructive session controls use filled red with
white text; reset filters is a neutral text action with a trash icon and hover.

## Report charts (outside the trading chart)

Report series deliberately have more color separation than chrome. These tokens
must not recolor trading candles, price levels or user drawings.

| Series | Token | Dark | Light |
| --- | --- | --- | --- |
| Balance / main series | `--report-blue` | `#5FBEFF` | `#2D7195` |
| Activity / comparison | `--report-peach` | `#FFAD7C` | `#A85A27` |
| Gain / positive P/L | `--report-positive` | `#51D6A0` | `#367552` |
| Loss / drawdown | `--report-negative` | `#FF7587` | `#AF494A` |
| Additional comparison | `--report-violet` | `#B49AFF` | `#7154A3` |
| Additional comparison | `--report-gold` | `#F3CE59` | `#876A1E` |

Use opaque line colors and clear column edges; existing columns may use restrained
shaded fills. Area fills stay low-opacity. Keep neutral gridlines,
axis labels, units and tooltips. Positive/negative text retains the project
financial roles; only plotted data uses the report variants. Violet and gold are
available for additional named comparison series (Dashboard symbol counts use violet), not assigned arbitrarily to
individual Monte Carlo paths. Labels and position remain necessary alongside color.

## Legacy trading chart

Native chart pane is #0F0F0F, chrome #000000, grid #202020, scale labels #DBDBDB. Light chart uses #FFFFFF. Candles use #26A69A / #EF5350, independent of report colors. Header and rails use these same neutral roles. Saved layouts cannot restore obsolete faded colors. Mentor/Editor use readable blue accents, with darker blue on white.
