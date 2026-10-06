# Independent scoped acceptance: PASS

60 route cases,6 calendar boundary cases and6 form/popup journeys pass. The source is unchanged throughout accepted browser runs and matches final20 source pins; UI contract document is pinned separately. No product edits or actual writes were performed.

## Coverage and findings

Canonical actual routes: Dashboard, Sessions, Trades, both Analytics sources, Market Data via view=market-data and TestingComponentReference via ui_reference=1. Each uses EN/VI, dark/light and1440/360; four labeled demo Dashboard cases provide populated report content.

No remaining alignment defect was found in this scope. 504 direct content control SVG samples stay within1px of the control's vertical center (observed maximum0.00px). 48 metric samples align to the first text line (maximum glyph-ink delta0.00px;2.5px tolerance accounts for font ink bounds). Wrapped labels intentionally use first-line alignment. Mobile text fields follow44px, desktop40px; compact icon actions retain their separate target sizes. Sessions arrow/play shapes keep their deliberate horizontal optical offset.

Dashboard uses concise period and sort labels and a prose matching/catalog count. The previous complete calendar week is Monday-Sunday UTC; the previous calendar month uses actual month lengths. Independent checks cover midweek/Monday, year rollover and leap February. Browser selection verifies URL bounds, custom date inputs and returning to all time. Legacy rolling presets are retained by source; root's separate focused harness covers their reload classification.

Analytics parent remains peach. The selected child and hovered child use the theme's content color; inactive child uses muted color. Hover fill stays transparent. Lowest computed child-label contrast is5.67:1.

Six representative journeys cover settings tabs/open/Escape focus return, fresh create form dataset popup and returning without submit, and Time/Date popup focus/clipping/Escape. Sources prove fresh create loads only the dataset catalog before explicit submission; all non-GET/HEAD/OPTIONS and external requests were guarded. No write attempt or page error occurred.

## Visual evidence and limits

Reviewed metric desktop crop, Sessions and Market Data mobile pages, mobile light Date popup, desktop dark create form and mobile light Settings. No new defect in the changed areas. Root's separate DataDesk screenshot/audit covers its shared MarketAssetCatalog consumer; independent canonical Market Data is fully covered.

The initial r1 was interrupted because the reviewer option-label oracle included decorative✓ in selected text. The corrected r2 extracts semantic label text and passes all60 cases; failed diagnostics remain saved. No implementation change occurred during accepted runs.

This acceptance is limited to UI alignment, copy/navigation and period selection. It does not validate actual mutations, provider/broker, trading canvas, financial calculations or the full product. Browser-native calendar appearance and intentional horizontal tab scrolling remain. No new full Axe scan was added for this focused slice; prior accessibility evidence remains separate.
