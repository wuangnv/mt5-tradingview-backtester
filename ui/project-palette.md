# Project palette

Owner-approved neutral black/white surfaces and stronger peach, blue and green accents apply to every MT5 web workspace and application
controls. The trading chart uses the Legacy black palette selected on
07/10/2026; report charts retain the stronger report palette below. Continue the
existing flat layout, sizes and navigation.
This is a project contract, not a change to the pinned shared UI foundation.

`foundation_v2/web/public/project-palette.css` is now a deterministic snapshot
of pinned `annam-compact@0.1.1`; edit the token source and regenerate, not this
snapshot. [compact-system.md](compact-system.md) owns the current color tables
and state treatment, superseding the historical values here. General controls
use neutral hover (owner rejected a muddy blue fill on 09/10/2026). Orange is the
primary action, blue is focus/information/progress, green success, red destructive
or loss, gold warning. Keep names and accessible state alongside color.

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
