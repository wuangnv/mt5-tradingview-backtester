"""Point-in-time visibility rules for economic-calendar events."""

from data_contracts import NewsEvent


def visible_events(events, decision_time_utc, allow_archive_proxy=False):
    decision_time_utc = int(decision_time_utc)
    visible = []
    for raw in events:
        event = raw if isinstance(raw, NewsEvent) else NewsEvent.from_mapping(raw)
        if event.known_at_utc is not None:
            if event.known_at_utc > decision_time_utc:
                continue
            status = "point_in_time"
        else:
            if not allow_archive_proxy or event.scheduled_time_utc > decision_time_utc:
                continue
            status = "archive_proxy"
        visible.append(
            {
                "event_id": event.event_id,
                "currency": event.currency,
                "scheduled_time_utc": event.scheduled_time_utc,
                "known_at_utc": event.known_at_utc,
                "event_type": event.event_type,
                "impact_source": event.impact_source,
                "time_precision": event.time_precision,
                "revision_source": event.revision_source,
                "point_in_time_status": status,
            }
        )
    return sorted(visible, key=lambda item: (item["scheduled_time_utc"], item["event_id"]))

