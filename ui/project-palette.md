# Project palette

Owner-approved vintage colors apply to every MT5 web workspace, including the
application-owned chart UI. Continue the existing flat layout, sizes and navigation.
This is a project contract, not a change to the pinned shared UI foundation.

`foundation_v2/web/public/project-palette.css` owns both theme values. The HTML
loads it before the application; `chart-legacy.css` imports it inside the chart
iframe. `component-interactions.css` maps project colors to existing shell, WM,
FX and UI roles. Canvas/chart engines read these CSS roles through
`projectPalette.js`; theme changes repaint series, volume and overlays. Saved
chart layouts cannot restore an older application palette.

| Role | Dark | Light | Usage |
| --- | --- | --- | --- |
| Canvas | `#171C20` | `#F4F1EB` | Main page |
| Chrome | `#1B2126` | `#EEEBE5` | Rail |
| Surface | `#232B30` | `#FBF9F4` | Data groups |
| Raised | `#2B343A` | `#FEFCF8` | Menus and overlays |
| Control | `#303A40` | `#E4E8E5` | Secondary actions |
| Hover | `#343F46` | `#DCE2DF` | Interactive surface |
| Text | `#ECE9E2` | `#283138` | Content and selected navigation |
| Muted | `#A6AFB3` | `#556166` | Metadata |
| Sea blue | `#8FAFC1` | `#3E6275` | Trading chart series and keyboard focus |
| On primary | `#171C20` | `#FBF9F4` | Text on filled actions |
| Highlight | `#D6A07B` | `#8F532F` | Parent tab with source tabs, quick-action icons, session counts, draft drawings |
| Positive | `#9DAF98` | `#4E684A` | Gains, success, target |
| Negative | `#D89B95` | `#984745` | Loss, errors, stop |
| Warning | `#D9BB84` | `#7B5826` | Caution and unavailable state |

Use colors by role rather than by page. Keep accents sparse: controls and labels
remain neutral unless an action or data meaning needs emphasis. Header navigation
hover only brightens text/icons; no hover fill or pointer border. Selected tabs
retain the ivory/dark underline. A selected parent with source tabs uses peach
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
| Action / hover | `#D6A07B` / `#E4B18D` | `#9A5934` / `#844A2A` |
| On action | `#171C20` | `#FFFFFF` |
| Peach soft / text | `#3D3028` / `#EDC4A6` | `#F1DFD1` / `#7C452B` |
| Delete / hover | `#A54F48` / `#B45A52` | `#984745` / `#803A38` |
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
| Balance / main series | `--report-blue` | `#78BDE3` | `#2D7195` |
| Activity / comparison | `--report-peach` | `#EAAF7F` | `#A85A27` |
| Gain / positive P/L | `--report-positive` | `#83C4A3` | `#367552` |
| Loss / drawdown | `--report-negative` | `#ED9693` | `#AF494A` |
| Additional comparison | `--report-violet` | `#B4A5DE` | `#7154A3` |
| Additional comparison | `--report-gold` | `#E5C876` | `#876A1E` |

Use opaque line colors and clear column edges; existing columns may use restrained
shaded fills. Area fills stay low-opacity. Keep neutral gridlines,
axis labels, units and tooltips. Positive/negative text retains the project
financial roles; only plotted data uses the report variants. Violet and gold are
available for additional named comparison series (Dashboard symbol counts use violet), not assigned arbitrarily to
individual Monte Carlo paths. Labels and position remain necessary alongside color.
