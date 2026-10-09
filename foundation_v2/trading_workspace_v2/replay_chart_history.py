"""Chart-only aggregation; replay execution continues using native immutable bars."""

from datetime import datetime, timezone
import math


MAX_CHART_BARS = 2000


def chart_period(resolution, timeframe_seconds):
    value = str(resolution)
    calendar = {'1D': 86400, '1W': 604800, '1M': None}
    if value in calendar:
        if not timeframe_seconds or timeframe_seconds > 86400 or 86400 % timeframe_seconds:
            raise ValueError('chart resolution is incompatible with dataset')
        return value
    try:
        seconds = (int(value[:-1]) * 86400 if value.endswith('D') else
                   int(value[:-1]) if value.endswith('S') else int(value) * 60)
    except (TypeError, ValueError):
        raise ValueError('invalid chart resolution') from None
    if not timeframe_seconds or seconds < timeframe_seconds or seconds % timeframe_seconds:
        raise ValueError('chart resolution is incompatible with dataset')
    if seconds != timeframe_seconds and (value.endswith(('D', 'S')) or seconds not in {60, 180, 300, 900, 1800, 3600, 7200, 14400}):
        raise ValueError('chart resolution is unsupported')
    return seconds


def chart_bucket(timestamp, period):
    if period == '1M':
        date = datetime.fromtimestamp(timestamp, timezone.utc)
        return int(datetime(date.year, date.month, 1, tzinfo=timezone.utc).timestamp()) * 1000
    if period == '1W':
        day = int(timestamp) // 86400
        return (day - datetime.fromtimestamp(timestamp, timezone.utc).weekday()) * 86400000
    seconds = 86400 if period == '1D' else period
    return int(timestamp // seconds) * seconds * 1000


def prepend_chart_row(buckets, row, period):
    """Merge in reverse time: oldest open and newest close remain authoritative."""
    timestamp = float(row['timestamp'])
    values = {key: float(row[key]) for key in ('open', 'high', 'low', 'close')}
    if not math.isfinite(timestamp) or not all(math.isfinite(value) for value in values.values()):
        return
    time = chart_bucket(timestamp, period)
    volume = row.get('volume')
    if volume is None:
        volume = row.get('tick_volume')
    volume = float(volume) if volume is not None else None
    if volume is not None and not math.isfinite(volume):
        volume = None
    newer = buckets.get(time)
    if newer is None:
        buckets[time] = {'time': time, **values}
        if volume is not None:
            buckets[time]['volume'] = volume
    else:
        newer.update(open=values['open'], high=max(newer['high'], values['high']), low=min(newer['low'], values['low']))
        if volume is not None and 'volume' in newer:
            newer['volume'] += volume
        else:
            newer.pop('volume', None)
