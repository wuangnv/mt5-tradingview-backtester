# Create-session layout — 09/10/2026

Owner request: use the supplied FX Replay screenshot as a layout reference only;
retain existing field text, values, controls and behavior.

The dialog now has compact session-type tabs in its header, a left navigation
for existing basic/advanced modes, and one scrollable form column. Header/footer
remain visible while scrolling. Under 700px, section navigation becomes a
horizontal row. The chart-engine wrapper is flat; input and picker contents,
capital entry, validation, API payload and backend remain unchanged.

Validation: web build passed; [browser report](report.json) has 10 passing cases
and no JavaScript errors. Live read-only geometry covers widths 1710, 1440, 768
and 360; navigation retains description/start-bar drafts, Prop round trips retain
drafts, and header/footer stay fixed. Labeled fixtures cover dark/light,
Vietnamese/English, multi-asset selection, unchanged creation payload, empty/error
states and generic selector regression. POST fixture responses are rejected;
no user session was created or altered.

Reviewed [desktop](layout-1710.png), [mobile](layout-360.png),
[advanced](advanced-1440.png), and [light picker](selected-768-light.png).
The reference's subscription banner, balance presets and unsupported settings
are outside the requested layout-only change. Existing advanced mode still adds
description/start-bar fields to the form.
