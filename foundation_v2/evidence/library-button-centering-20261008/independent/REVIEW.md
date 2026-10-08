# Independent review: primary action content centering

Result: PASS 10/10. Run `node foundation_v2/evidence/library-button-centering-20261008/independent/qa.mjs` from the product root. `results.json` contains rest/hover geometry and screenshots.

Eight actual local GET-only cases cover dark/light, 1710/360 px, and Vietnamese/English. Two explicitly labeled presentation cases additionally inspect Download, disabled Resume, and enabled Pause in dark desktop Vietnamese and light mobile English. Fixture measurement waits for the initial speed line so backend-poll presentation changes are not mistaken for hover movement.

The oracle unions the SVG bounds and direct text-node Range bounds and compares that union with the button center on both axes. Actual Vietnamese Download has center delta **0/0 px**, equal horizontal inner gaps **27.78125/27.78125 px**, and vertical gaps 11/11 px desktop or 13/13 px mobile. English Download has a negligible horizontal rounding delta -0.0078125 px and zero vertical delta. Pause and Resume likewise remain centered. All measured SVGs use block display, with no inline baseline drift.

Rest and settled hover retain identical button size, position, and inner gaps. Enabled hover surfaces remain distinct; disabled controls retain their state. The primary slot stays116 px wide, 40 px desktop /44 px mobile high, and begins8 px inside the Actions cell. Status remains112 px and Actions196 px. Vietnamese ordinary status text to button outer edge stays64.59375 px; English stays40.484375 px. Centering changes the icon's position inside the existing slot, not the slot's distance from Status.

Visually inspected actual dark1710 Vietnamese Download hover, actual light360 English hover, and dark1710 Pause fixture hover. Icon/text now sit centrally in the pill surface; column and progress layout remain unchanged. Native horizontal table scrolling remains contained at360, without document overflow.

No source edit, commit, download/update/pause/resume/cancel/delete, provider call, broker action, or service restart occurred. Isolated contexts block external origins, live routes, WebSockets, and non-read requests. Zero attempted writes and zero browser errors. Acceptance is scoped to this one-line CSS centering change; prior progress/state coverage is not replaced by whole-product acceptance.
