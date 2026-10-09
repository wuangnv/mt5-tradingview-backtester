"""Journal annotations for one replay scope without transmitting journal text."""
from .store import StoredContractUntrusted


def build_journal_context(records, workspace_id, session_id):
    trades = {}
    count = 0
    for record in records:
        if record.get("workspace_id", workspace_id) != workspace_id:
            raise StoredContractUntrusted()
        payload = record.get("payload") or {}
        source = payload.get("source") or {}
        if session_id not in (source.get("session_id"), source.get("replay_session_id")):
            continue
        count += 1
        aliases = dict.fromkeys(value for value in (source.get("trade_id"), source.get("id"))
                                if isinstance(value, str) and value)
        tags = payload.get("tags")
        tags = tags if isinstance(tags, list) else []
        for trade_id in aliases:
            item = trades.setdefault(trade_id, {"trade_id": trade_id, "tags": [], "record_count": 0})
            item["record_count"] += 1
            for tag in tags:
                if isinstance(tag, str) and tag not in item["tags"]:
                    item["tags"].append(tag)
    return {"schema_version": "replay-journal-context-v1", "workspace_id": workspace_id,
            "session_id": session_id, "record_count": count, "trades": list(trades.values())}
