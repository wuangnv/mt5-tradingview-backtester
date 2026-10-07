# FX Replay Legacy: layout Save research

Observed on 7 October 2026 in the owner's existing Legacy reference tab. No cloud
layout mutation, account change, trade or replay step was submitted for this research.

## Verified reference behavior

- The session title is generic italic text, separate from the layout selector.
- The clean toolbar has `All changes saved [disabled]`, with a layout name and
  visible `Save` text. Clean does not mean hiding Save.
- Manage layouts shows `Save layout Ctrl + S [disabled]`, `Make a copy…`,
  `Rename…` and `Open layout…`.
- Official FAQ: https://support.fxreplay.com/faqs — “Click Save Layout on the
  chart page to store your indicators, drawings, and chart style for reuse.”
- Official article, visibly updated June 27, 2026:
  https://support.fxreplay.com/articles/do-charts-have-autosave-my-charts-are-not-saving
  — “To be safe, before ending your session, click on the layout at the top right
  corner and wait until it says ‘Saved’.”

The article's cookie advice is inconsistent between its introduction and body;
it is not used as an implementation requirement. Dirty transitions, autosave
cadence, network payload and FX cloud protocol were not directly tested.

## Project implementation

Keep visible Save/Lưu with saved/dirty/saving/error states. Clean and saving are
disabled; a dirty or failed layout enables manual Save. Ctrl+S saves immediately.
Native edit notifications schedule browser-local autosave after five seconds;
this is project policy, not a researched claim about FX's debounce.

Advanced Charts `widget.save` produces the snapshot. The existing local storage
contract scopes it by workspace/session/dataset and replay cutoff. Later-cutoff
snapshots cannot restore in an earlier historical view. New edits, changed replay
generation/cutoff, timeouts and component disposal invalidate old callbacks.
Storage errors remain retryable and never publish a false saved state.

This saves chart layout, not simulator execution, account state or journal notes.
There is no new cloud/backend layout service or cross-device sync. Copy, rename,
open multiple saved layouts and multi-chart arrangements remain disabled.
