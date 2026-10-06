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
| Primary | `#8FAFC1` | `#3E6275` | Main actions, series, keyboard focus |
| On primary | `#171C20` | `#FBF9F4` | Text on filled actions |
| Highlight | `#D6A07B` | `#8F532F` | Secondary chart series, draft drawings |
| Positive | `#9DAF98` | `#4E684A` | Gains, success, target |
| Negative | `#D89B95` | `#984745` | Loss, errors, stop |
| Warning | `#D9BB84` | `#7B5826` | Caution and unavailable state |

Use colors by role rather than by page. Keep accents sparse: controls and labels
remain neutral unless an action or data meaning needs emphasis. Header navigation
hover only brightens text/icons; no hover fill or pointer border. Selected tabs
retain the continuous ivory/dark underline. Dropdown selection uses a checkmark,
not a persistent hover fill. Financial colors retain their distinct meanings.

Never recolor user-defined drawings, change financial data, or substitute demo
data for a failed actual read. Demo, empty, unavailable and loading keep their
existing data/state ownership. Contrast checks cover content/metadata against
surfaces and primary/semantic action foregrounds in both themes.
