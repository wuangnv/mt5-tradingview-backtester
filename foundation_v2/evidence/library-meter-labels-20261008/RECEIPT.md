# Transfer meter labels — 08/10/2026

Owner requested removing Waiting and all similar transfer-state text from Actions.
Removed the visible state label entirely for queued/running/pausing/paused/failed/
processing jobs. Cooldown renders bare mm:ss instead of the Wait prefix. Percentage,
received bytes/speed, approximate ETA, progress and icon controls stay intact.
ARIA names, tooltips and the details dialog retain full status/error descriptions.
Removed the orphaned label CSS and updated the existing UI contract.

Production build and diff check PASS. Independent focused browser/source review
covers representative transfer states and cooldown in isolated, labeled fixtures;
see independent/REVIEW.md and results.json. Runtime GET-only observations are
separate from fixtures. No resume, service restart, provider call or data write.
This is a presentation change; worker/backend behavior and prior activation state
remain unchanged.
