def next_interval_cursor(rows, cursor, limit, interval_seconds, timeframe_seconds):
    """First available bar in the next UTC bucket, bounded by the known cursor."""
    if (isinstance(interval_seconds, bool) or not isinstance(interval_seconds, int)
            or not 1 <= interval_seconds <= 86400):
        raise ValueError("replay interval must be integer seconds between 1 and 86400")
    if (isinstance(timeframe_seconds, bool) or not isinstance(timeframe_seconds, int)
            or timeframe_seconds < 1):
        raise ValueError("dataset timeframe is required for interval replay")
    if interval_seconds < timeframe_seconds or interval_seconds % timeframe_seconds:
        raise ValueError("replay interval must be a multiple of the dataset timeframe")
    if not 0 <= cursor <= limit < len(rows):
        raise ValueError("interval replay cursor is outside the available range")
    boundary = (int(rows[cursor]["timestamp"]) // interval_seconds + 1) * interval_seconds
    # Gaps are skipped by timestamps, not by inventing candles. Keep the same
    # bounded execution cost as ReplayStep's existing 1000-bar batch contract.
    stop = min(limit, cursor + 1000)
    for index in range(cursor + 1, stop + 1):
        if int(rows[index]["timestamp"]) >= boundary:
            return index
    if stop < limit:
        raise ValueError("replay interval exceeds the 1000-bar execution limit")
    return limit
