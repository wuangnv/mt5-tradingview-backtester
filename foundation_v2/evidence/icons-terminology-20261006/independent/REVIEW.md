# Independent icons and terminology review

Status: **PASS_SCOPED_ICONS_TERMINOLOGY**, combining 50 distinct cases.

Scope: Dashboard, Sessions and Trades, actual/demo, dark/light, Vietnamese/English, desktop1710/mobile360 (48 cases), plus 2 explicitly intercepted partial Dashboard cases. Actual traffic GET/HEAD/OPTIONS only, no writes or user data mutation. Detail inspectors were opened and closed with Escape.

Source and runtime findings:

- Dashboard partial-info icon/tooltip markup and CSS removed. Partial scope remains attached to the Performance region as `aria-description`; controlled GET response modifies only performance status and scope counts to1/3. Both translated descriptions independently verified. Ordinary Dashboard and demo flows have no leftover info control.
- Shared journal glyph matches exactly between Trades detail buttons and Sessions Journal, with16×16 rendered SVGs, decorative `aria-hidden`, and existing accessible control labels. Both actual and demo trade readers contained rows; detail inspector opening/closing passed at every tested mode/theme/language/width. Inspector contents/behavior were not redesigned.
- Actual/demo New session has a separate SVG plus before translated text, no text plus character,16×16 rendered size. Demo disabled state retained; actual navigation remains a link.
- Divider renders1×18px after table column tools and before filter label, decorative/hidden from accessibility. Mobile wrapping remains within the document.
- Vietnamese “Kiểm thử lịch sử” communicates historical backtesting. “Thử thách cấp vốn” fits the app's simulated challenge context; Dashboard supporting text explicitly says “mô phỏng” and English “simulated”. User-facing labels changed while internal source/action values and APIs remain unchanged. English domain terminology remains intact.

Initial run:38 passing cases,12 retained failures with source drift during owner corrections.11 failures were Sessions shared Journal rendering18px under older CSS; separate plus16 check was already passing (initial verbal plus hypothesis corrected after inspecting the failing call). Owner fixed runtime icon size ownership. The remaining English partial failure was a test oracle expecting `1/3` while shipped translation says `1 of3`.

Final affected verification:16 Sessions cases and Vietnamese partial fixture pass on stable final source; English partial fixture passes in a separate stable one-case run with its correct translation oracle. Earlier16 Dashboard and16 Trades cases are retained as scoped evidence; they are not falsely described as all rerun after the small Sessions CSS fix. Final pins include testing-standard.css and session-performance.css. No runtime errors or unexpected/external/write requests were observed in any run.

Visual review included actual Vietnamese dark desktop Dashboard, Vietnamese light desktop Trades, English dark mobile trade inspector, final Vietnamese dark desktop/light mobile Sessions. Copy fits tested layouts; glyphs and divider use the accepted system.

Evidence: `report.json` retains initial failures, `final/report.json` retains the translated-oracle failure alongside17 final passes, `partial-en/report.json` closes that single oracle, and `final-receipt.json` records combined unique cases/final pins. This accepts only the specified UI/copy scope, not financial calculations, broker capabilities or whole-product functionality. No product source edits, commits or server starts by this reviewer.
