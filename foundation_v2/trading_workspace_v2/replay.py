from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from pydantic import ValidationError

from .artifacts import ArtifactStore
from .contracts import ReplaySessionCatalogItem
from .prop_replay import (
    ReplayPropConnectionError,
    replay_event_operation_id,
    replay_mark_to_prop_event,
    validate_replay_prop_binding,
)
from .replay_execution import (
    ReplayExecutionError,
    ReplayExecutionSnapshot,
    advance_replay_execution,
    change_replay_protection,
    fork_replay_execution_checkpoint,
    initialize_replay_execution,
    parse_replay_execution_snapshot,
    queue_market_order,
    reconstruct_replay_execution_checkpoint,
    replay_event_for_snapshot,
)
from .store import PostgresStore
from .replay_activity import new_timing, validate_activity
from .replay_interval import next_interval_cursor
from .tick_history import TickHistoryStore


class ReplayService:
    def __init__(self, store: PostgresStore, artifacts: ArtifactStore):
        self.store = store
        self.artifacts = artifacts
        tick_root = getattr(artifacts, 'root', None)
        self.ticks = TickHistoryStore(tick_root) if tick_root is not None else None

    def _dataset_rows(self, workspace_id: str, dataset_id: str) -> tuple[object, list[dict]]:
        manifest = self.store.get_dataset(workspace_id, dataset_id)
        if manifest is None:
            raise LookupError("dataset not found")
        rows = self.artifacts.read_dataset(manifest.artifact_path, manifest.artifact_sha256)
        return manifest, rows

    def _dataset_timing(self, workspace_id, dataset_id, *, index=0, at_or_before=None):
        manifest = self.store.get_dataset(workspace_id, dataset_id)
        if manifest is None:
            raise LookupError('dataset not found')
        if hasattr(self.artifacts, 'read_dataset_replay_timing'):
            timing = self.artifacts.read_dataset_replay_timing(manifest.artifact_path, manifest.artifact_sha256,
                       index=index, at_or_before=at_or_before)
            if timing['row_count'] != manifest.row_count:
                raise RuntimeError('dataset row count differs from immutable manifest')
        else:
            from bisect import bisect_right
            rows = self.artifacts.read_dataset(manifest.artifact_path, manifest.artifact_sha256)
            if index < 0 or index >= len(rows):
                raise ValueError('start_index exceeds dataset')
            timing = {'row_count': len(rows), 'first_utc': int(rows[0]['timestamp']),
                      'last_utc': int(rows[-1]['timestamp']), 'index_utc': int(rows[index]['timestamp']),
                      'cursor_index': index if at_or_before is None else bisect_right(rows, at_or_before, key=lambda row: int(row['timestamp'])) - 1}
        return manifest, timing

    def _dataset_slice(self, workspace_id, dataset_id, start, stop):
        manifest = self.store.get_dataset(workspace_id, dataset_id)
        if manifest is None:
            raise LookupError('dataset not found')
        if hasattr(self.artifacts, 'read_dataset_indices'):
            rows = self.artifacts.read_dataset_indices(manifest.artifact_path, manifest.artifact_sha256,
                        start_index=start, end_index=stop)
        else:
            rows = self._dataset_rows(workspace_id, dataset_id)[1][start:stop]
        if len(rows) != stop - start:
            raise RuntimeError('dataset row count differs from immutable manifest')
        return manifest, rows

    def _dataset_timings(self, workspace_id, dataset_id, queries):
        manifest = self.store.get_dataset(workspace_id, dataset_id)
        if manifest is None:
            raise LookupError('dataset not found')
        if hasattr(self.artifacts, 'read_dataset_replay_timings'):
            timings = self.artifacts.read_dataset_replay_timings(manifest.artifact_path,
                manifest.artifact_sha256, queries=queries)
            if any(timing['row_count'] != manifest.row_count for timing in timings):
                raise RuntimeError('dataset row count differs from immutable manifest')
            return timings
        return [self._dataset_timing(workspace_id, dataset_id, **query)[1] for query in queries]

    def _step_window(self, workspace_id, dataset_id, current, steps, interval, *, limit=None):
        if isinstance(steps, bool) or not isinstance(steps, int) or not 1 <= steps <= 1000:
            raise ValueError('replay steps must be an integer between 1 and 1000')
        manifest, timing = self._dataset_timing(workspace_id, dataset_id, index=current)
        limit = timing['row_count'] - 1 if limit is None else limit
        stop = min(current + (1000 if interval is not None else steps), limit)
        _, rows = self._dataset_slice(workspace_id, dataset_id, current, stop + 1)
        if interval is None:
            cursor = stop
        else:
            if steps != 1:
                raise ValueError('choose either replay interval or a bar count')
            local = next_interval_cursor(rows, 0, len(rows) - 1, interval, manifest.timeframe_seconds)
            boundary = (int(rows[0]['timestamp']) // interval + 1) * interval
            if int(rows[local]['timestamp']) < boundary and stop < limit:
                raise ValueError('replay interval exceeds the 1000-bar execution limit')
            cursor = current + local
        return manifest, rows[:cursor - current + 1], cursor, timing['row_count']

    @staticmethod
    def _period_bounds(payload):
        period = payload.get('session_period')
        if period is None:
            return None
        try:
            bounds = period['asset_bounds'][payload['dataset_id']]
            start, end = bounds['start_cursor_index'], bounds['end_cursor_index']
            if isinstance(start, bool) or isinstance(end, bool) or not isinstance(start, int) or not isinstance(end, int) or not 0 <= start <= end:
                raise ValueError()
            return bounds
        except (KeyError, TypeError, ValueError):
            raise RuntimeError('stored replay period is invalid') from None

    def _single_period(self, workspace, dataset, timing, cursor, start_timestamp, end_timestamp):
        if any(value is not None and not timing['first_utc'] <= value <= timing['last_utc']
               for value in (start_timestamp, end_timestamp)):
            raise ValueError('requested replay period is outside available dataset range')
        if start_timestamp is not None:
            cursor = self._dataset_timing(workspace, dataset, at_or_before=start_timestamp - 1)[1]['cursor_index'] + 1
        if cursor >= timing['row_count']:
            raise ValueError('start_timestamp is outside available dataset')
        end = (timing['row_count'] - 1 if end_timestamp is None else
               self._dataset_timing(workspace, dataset, at_or_before=end_timestamp)[1]['cursor_index'])
        if end <= cursor:
            raise ValueError('selected replay period has no future bars')
        resolved = self._dataset_timings(workspace, dataset, [{'index': cursor}, {'index': end}])
        bounds = {'start_cursor_index': cursor, 'end_cursor_index': end,
                  'start_timestamp': resolved[0]['index_utc'], 'end_timestamp': resolved[1]['index_utc']}
        return cursor, {'schema_version': 'replay-period-v1', 'requested_start_timestamp': start_timestamp,
            'requested_end_timestamp': end_timestamp, 'start_timestamp': bounds['start_timestamp'],
            'end_timestamp': bounds['end_timestamp'], 'asset_bounds': {dataset: bounds}}

    def create(self, workspace_id: str, dataset_id: str, start_index: int = 0, *, name=None,
               description="", starting_balance=None, playbook_id=None, playbook_revision=None,
               chart_engine="legacy", dataset_ids=None, start_timestamp=None, end_timestamp=None) -> dict:
        for value in (start_timestamp, end_timestamp):
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
                raise ValueError('replay period requires nonnegative integer UTC timestamps')
        if start_timestamp is not None and start_index != 0:
            raise ValueError('choose start_timestamp or a nonzero start_index')
        if start_timestamp is not None and end_timestamp is not None and end_timestamp <= start_timestamp:
            raise ValueError('end_timestamp must be after start_timestamp')
        manifest, timing = self._dataset_timing(workspace_id, dataset_id, index=start_index)
        if chart_engine != "legacy":
            raise ValueError("chart engine is unavailable")
        if (playbook_id is None) != (playbook_revision is None):
            raise ValueError("playbook id and revision must be supplied together")
        if playbook_id:
            strategy = self.store.get_record_revision(workspace_id, "playbook", playbook_id, playbook_revision)
            if strategy is None or strategy.get("deleted"):
                raise LookupError("playbook not found")
        if len(description) > 2000:
            raise ValueError("description is too long")
        if starting_balance is not None:
            starting_balance = Decimal(str(starting_balance))
            if not starting_balance.is_finite() or starting_balance <= 0:
                raise ValueError("starting balance must be finite and positive")
        elif dataset_ids and len(dataset_ids) > 1:
            starting_balance = Decimal('10000')
        payload = {
            "dataset_id": dataset_id,
            "cursor_index": int(start_index),
            "branch_id": uuid4().hex,
            "parent_session_id": None,
            "parent_revision": None,
            "status": "paused",
            "timing": new_timing(),
            "chart_engine": chart_engine,
        }
        period_requested = start_timestamp is not None or end_timestamp is not None
        if period_requested and (dataset_ids is None or len(dataset_ids) <= 1):
            cursor, period = self._single_period(workspace_id, dataset_id, timing, start_index, start_timestamp, end_timestamp)
            payload.update(cursor_index=cursor, session_period=period)
        if dataset_ids is not None:
            from .replay_portfolio import initialize_portfolio
            payload = initialize_portfolio(self, workspace_id, payload, dataset_ids, primary=(manifest, timing),
                start_timestamp=start_timestamp, end_timestamp=end_timestamp)
        if name is not None:
            if not name.strip() or len(name.strip()) > 160:
                raise ValueError("name is invalid")
            payload["name"] = name.strip()
        if description:
            payload["description"] = description
        if starting_balance is not None:
            payload["starting_balance"] = str(starting_balance)
            payload["starting_balance_ccy"] = (getattr(manifest, "instrument_spec", None) or {}).get("account_ccy", "USD")
        if playbook_id:
            payload.update(playbook_id=playbook_id, playbook_revision=playbook_revision)
        record = self.store.create_record(workspace_id, "replay", payload)
        return self.view(workspace_id, record["record_id"])

    def _update_payload(self, workspace_id, session_id, expected_revision, payload):
        if payload.get('asset_states'):
            from .replay_portfolio import sync_active_state
            payload = sync_active_state(payload)
        return self.store.update_record(workspace_id, 'replay', session_id, expected_revision, payload)

    def select_asset(self, workspace_id, session_id, expected_revision, dataset_id):
        from .replay_portfolio import select_asset
        return select_asset(self, workspace_id, session_id, expected_revision, dataset_id)

    def list_sessions(self, workspace_id: str) -> list[dict]:
        """Return a tenant-scoped catalog projection for replay sessions.

        This is deliberately metadata-only.  In particular, it does not call
        :meth:`view`, read the artifact rows, or include the execution ledger.
        A missing dataset is retained as an unavailable catalog item so a
        picker can explain why a session cannot be opened instead of silently
        dropping the user's record.
        """

        items: list[dict] = []
        for record in self.store.list_records(workspace_id, "replay"):
            if not isinstance(record, dict):
                raise RuntimeError("replay catalog record is invalid")
            payload = record.get("payload")
            if not isinstance(payload, dict):
                raise RuntimeError("replay catalog record payload is invalid")

            dataset_id = payload.get("dataset_id")
            if dataset_id is not None and not isinstance(dataset_id, str):
                raise RuntimeError("replay catalog dataset id is invalid")
            manifest = (
                self.store.get_dataset(workspace_id, dataset_id)
                if dataset_id
                else None
            )
            dataset_ids = payload.get('dataset_ids', [dataset_id] if dataset_id else [])
            manifests = [self.store.get_dataset(workspace_id, key) for key in dataset_ids]
            try:
                item = ReplaySessionCatalogItem(
                    record_id=record["record_id"],
                    name=payload.get("name", ""),
                    description=payload.get("description", ""),
                    archived=payload.get("archived", False),
                    revision=record["revision"],
                    dataset_id=dataset_id,
                    dataset_ids=dataset_ids,
                    instrument_ids=[entry.instrument_id for entry in manifests if entry],
                    instrument_id=manifest.instrument_id if manifest else None,
                    timeframe=manifest.timeframe if manifest else None,
                    timeframe_seconds=manifest.timeframe_seconds if manifest else None,
                    row_count=manifest.row_count if manifest else None,
                    cursor_index=payload.get("cursor_index", 0),
                    status=payload.get("status", "unknown"),
                    branch_id=payload.get("branch_id"),
                    parent_session_id=payload.get("parent_session_id"),
                    parent_revision=payload.get("parent_revision"),
                    dataset_available=bool(manifests) and all(entry is not None for entry in manifests),
                    has_execution=payload.get("execution") is not None or any(state.get('execution') for state in payload.get('asset_states', {}).values()),
                    created_at_utc=record["created_at_utc"],
                    updated_at_utc=record["updated_at_utc"],
                )
            except (KeyError, TypeError, ValueError, ValidationError) as exc:
                raise RuntimeError("replay catalog record is invalid") from exc
            items.append(item.model_dump(mode="json"))
        return items

    def update_metadata(self, workspace_id: str, session_id: str, expected_revision: int, changes: dict) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        if not changes or set(changes) - {"name", "description", "archived"}:
            raise ValueError("only replay metadata can be updated")
        payload = dict(record["payload"])
        payload.update(changes)
        return self._update_payload(workspace_id, session_id, expected_revision, payload)

    @staticmethod
    def _execution_snapshot(payload: dict) -> ReplayExecutionSnapshot | None:
        raw = payload.get("execution")
        return parse_replay_execution_snapshot(raw) if raw is not None else None

    @staticmethod
    def _iso_utc(timestamp: int) -> str:
        return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")

    def initialize_execution(
        self,
        workspace_id: str,
        session_id: str,
        expected_revision: int,
        *,
        instrument_spec: dict,
        cost_model: dict,
        spread_price,
        timeframe_seconds: int,
        starting_balance,
        research_margin=None,
        tick_snapshot_id=None,
    ) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        payload = dict(record["payload"])
        if payload.get("execution") is not None:
            raise RuntimeError("replay execution is already initialized")
        manifest, _ = self._dataset_timing(workspace_id, payload["dataset_id"], index=payload['cursor_index'])
        if payload.get('asset_states'):
            if tick_snapshot_id or research_margin is not None:
                raise ValueError('multi-asset replay supports bar execution without a broker margin model')
            if Decimal(str(starting_balance)) != Decimal(payload['starting_balance']):
                raise ValueError('multi-asset execution must use the shared starting balance')
            if (instrument_spec.get('account_ccy') != payload['starting_balance_ccy']
                    or cost_model.get('account_ccy') != payload['starting_balance_ccy']):
                raise ValueError('multi-asset execution must use the shared account currency')
        if manifest.timeframe_seconds is not None and int(manifest.timeframe_seconds) != int(timeframe_seconds):
            raise ValueError("timeframe_seconds does not match the immutable dataset manifest")
        snapshot = initialize_replay_execution(
            replay_session_id=session_id,
            branch_id=payload["branch_id"],
            dataset_id=payload["dataset_id"],
            dataset_sha256=manifest.artifact_sha256,
            instrument_spec=instrument_spec,
            cost_model=cost_model,
            spread_price=spread_price,
            timeframe_seconds=timeframe_seconds,
            starting_balance=starting_balance,
            cursor_index=int(payload["cursor_index"]),
            research_margin=research_margin,
        )
        if snapshot.instrument_spec["instrument_id"] != manifest.instrument_id:
            raise ValueError("instrument_spec does not match the replay dataset instrument")
        if manifest.instrument_spec is not None:
            manifest_instrument = initialize_replay_execution(
                replay_session_id=session_id,
                branch_id=payload["branch_id"],
                dataset_id=payload["dataset_id"],
                dataset_sha256=manifest.artifact_sha256,
                instrument_spec=manifest.instrument_spec,
                cost_model=cost_model,
                spread_price=spread_price,
                timeframe_seconds=timeframe_seconds,
                starting_balance=starting_balance,
                cursor_index=int(payload["cursor_index"]),
            ).instrument_spec
            if snapshot.instrument_spec != manifest_instrument:
                raise ValueError("instrument_spec does not match the immutable dataset manifest")
        if tick_snapshot_id:
            from .replay_tick_execution import initialize_tick_execution
            if self.ticks is None:
                raise ValueError('tick history storage is unavailable')
            ticks = self.ticks.load_manifest(workspace_id, tick_snapshot_id)
            if (ticks['symbol'] != manifest.instrument_id or ticks['source']['mode'] != 'demo'
                    or manifest.source.provider != f"{ticks['source']['server']} / MT5"):
                raise ValueError('tick source does not match the replay dataset')
            if research_margin is None:
                raise ValueError('tick execution requires an explicit research leverage assumption')
            _, rows = self._dataset_slice(workspace_id, payload['dataset_id'], payload['cursor_index'], payload['cursor_index'] + 1)
            bar = rows[0]
            begin, end = int(bar['timestamp']) * 1000, (int(bar['timestamp']) + timeframe_seconds) * 1000
            self.ticks.assert_interval(workspace_id, tick_snapshot_id, begin, end)
            quotes = self.ticks.iter_ticks(workspace_id, tick_snapshot_id, begin, end)
            last = None
            for last in quotes:
                pass
            if last is None:
                raise ValueError('current replay minute has no ticks')
            snapshot = initialize_tick_execution(tick_snapshot_id=tick_snapshot_id,
                tick_snapshot_sha256=tick_snapshot_id.removeprefix('ticks-'),
                replay_session_id=session_id, branch_id=payload['branch_id'], dataset_id=payload['dataset_id'],
                dataset_sha256=manifest.artifact_sha256, instrument_spec=instrument_spec,
                cost_model=cost_model, spread_price=spread_price, timeframe_seconds=timeframe_seconds,
                starting_balance=starting_balance, cursor_index=int(payload['cursor_index']), research_margin=research_margin)
            from .replay_execution import ReplayExecutionEventV2
            quote = ReplayExecutionEventV2(sequence=1, kind='price_mark', replay_session_id=session_id,
                branch_id=payload['branch_id'], dataset_id=payload['dataset_id'], dataset_sha256=manifest.artifact_sha256,
                cursor_index=snapshot.cursor_index, virtual_time_utc=end // 1000, balance=snapshot.balance,
                floating_pl=0, equity=snapshot.balance, open_positions=0, pending_orders=0,
                details={'tick_snapshot_id': tick_snapshot_id, 'tick_snapshot_sha256': snapshot.tick_snapshot_sha256,
                    'window_start_msc': begin, 'window_end_msc': end,
                    'quote_source': 'broker_bid_ask', 'time_msc': last['time_msc'], 'sequence': last['sequence'],
                    'bid': str(last['bid']), 'ask': str(last['ask']), 'bid_close': str(last['bid']), 'ask_close': str(last['ask']),
                    'quote_mid_close': str((Decimal(str(last['bid'])) + Decimal(str(last['ask']))) / 2),
                    'mid_close': str(bar['close']), 'open_position': None, 'pending_market_order': None,
                    'intrabar_equity_coverage': 'complete'})
            snapshot = snapshot.model_copy(update={'last_bid': Decimal(str(last['bid'])), 'last_ask': Decimal(str(last['ask'])),
                'event_sequence': 1, 'ledger': [quote.model_dump(mode='json')]})
            snapshot = parse_replay_execution_snapshot(snapshot.model_dump(mode='json'))
        payload["execution"] = snapshot.model_dump(mode="json")
        self._update_payload(workspace_id, session_id, expected_revision, payload)
        return self.view(workspace_id, session_id)

    def tick_options(self, workspace_id, session_id):
        record = self.store.get_record(workspace_id, 'replay', session_id)
        if record is None:
            raise LookupError('replay session not found')
        if record['payload'].get('asset_states'):
            return {'available': False, 'execution_capability': False, 'reason': 'Phiên nhiều tài sản sử dụng nến OHLC.'}
        manifest, timing = self._dataset_timing(workspace_id, record['payload']['dataset_id'], index=record['payload']['cursor_index'])
        result = {'available': False, 'execution_capability': False, 'reason': 'Tick chưa được tải cho asset này.'}
        if self.ticks is None:
            return result
        ticks = self.ticks.latest(workspace_id, manifest.instrument_id)
        if not ticks:
            return result
        result.update(snapshot_id=ticks['snapshot_id'], row_count=ticks['row_count'], bytes=ticks['bytes'],
            first_tick_msc=ticks['first_tick_msc'], last_tick_msc=ticks['last_tick_msc'], quality=ticks['quality'])
        if manifest.source.provider != f"{ticks['source']['server']} / MT5":
            return {**result, 'reason': 'Nguồn tick không khớp nguồn dataset.'}
        start = timing['index_utc'] * 1000
        try:
            self.ticks.assert_interval(workspace_id, ticks['snapshot_id'], start, start + 1000 * manifest.timeframe_seconds)
            first = next(self.ticks.iter_ticks(workspace_id, ticks['snapshot_id'], start, start + 1000 * manifest.timeframe_seconds), None)
            if first is None:
                return {**result, 'reason': 'Broker không trả tick trong phút đang chọn.'}
        except ValueError:
            return {**result, 'reason': 'Phút đang chọn nằm ngoài đoạn tick đã tải.'}
        return {**result, 'available': True, 'reason': 'Bid/Ask lịch sử; phí vẫn theo model đã chọn.'}

    @staticmethod
    def _checkpoint(snapshot, **kwargs):
        if snapshot.schema_version == 'replay-execution-tick-v1':
            from .replay_tick_execution import reconstruct_tick_execution_checkpoint
            return reconstruct_tick_execution_checkpoint(snapshot, **kwargs)
        return reconstruct_replay_execution_checkpoint(snapshot, **kwargs)

    def queue_market_order(
        self,
        workspace_id: str,
        session_id: str,
        expected_revision: int,
        *,
        operation_id: str,
        side: str,
        quantity,
        stop_loss,
        take_profit,
    ) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        payload = dict(record["payload"])
        snapshot = self._execution_snapshot(payload)
        if snapshot is None:
            raise ValueError("replay execution is not initialized")
        if payload.get('asset_states'):
            manifest, rows = self._dataset_slice(workspace_id, payload['dataset_id'], payload['cursor_index'], payload['cursor_index'] + 1)
            from .replay_portfolio import closed_time
            if closed_time(manifest, rows[0]) < payload['replay_clock_utc']:
                raise ValueError('asset has no newly closed bar at the shared replay clock')
        if snapshot.cursor_index != int(payload["cursor_index"]):
            raise RuntimeError("replay execution cursor is inconsistent with replay state")
        _, timing = self._dataset_timing(workspace_id, payload["dataset_id"], index=snapshot.cursor_index)
        bounds = self._period_bounds(payload)
        limit = bounds['end_cursor_index'] if bounds else timing['row_count'] - 1
        if payload.get("status") == "completed" or snapshot.cursor_index >= limit:
            raise ValueError("market order requires a future replay bar")
        queued = queue_market_order(
            snapshot,
            operation_id=operation_id,
            side=side,
            quantity=quantity,
            stop_loss=stop_loss,
            take_profit=take_profit,
        )
        payload["execution"] = queued.model_dump(mode="json")
        self._update_payload(workspace_id, session_id, expected_revision, payload)
        return self.view(workspace_id, session_id)

    def change_protection(self, workspace_id: str, session_id: str, expected_revision: int,
                          *, target_id: str, operation_id: str, stop_loss, take_profit) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        payload = dict(record["payload"])
        snapshot = self._execution_snapshot(payload)
        if snapshot is None:
            raise ValueError("replay execution is not initialized")
        if snapshot.cursor_index != int(payload["cursor_index"]):
            raise RuntimeError("replay execution cursor is inconsistent with replay state")
        manifest, rows = self._dataset_slice(workspace_id, payload["dataset_id"], snapshot.cursor_index, snapshot.cursor_index + 1)
        _, timing = self._dataset_timing(workspace_id, payload['dataset_id'], index=snapshot.cursor_index)
        bounds = self._period_bounds(payload)
        limit = bounds['end_cursor_index'] if bounds else timing['row_count'] - 1
        if payload.get("status") == "completed" or snapshot.cursor_index >= limit:
            raise ValueError("protection changes require a future replay bar")
        bar = rows[0]
        if payload.get('asset_states'):
            from .replay_portfolio import closed_time
            if closed_time(manifest, bar) < payload['replay_clock_utc']:
                raise ValueError('asset has no newly closed bar at the shared replay clock')
        protection = change_replay_protection
        if snapshot.schema_version == 'replay-execution-tick-v1':
            from .replay_tick_execution import change_tick_protection
            protection = change_tick_protection
        changed = protection(snapshot, target_id=target_id, operation_id=operation_id,
            stop_loss=stop_loss, take_profit=take_profit, mid_close=bar["close"],
            virtual_time_utc=int(bar["timestamp"]) + snapshot.timeframe_seconds)
        payload["execution"] = changed.model_dump(mode="json")
        self._update_payload(workspace_id, session_id, expected_revision, payload)
        return self.view(workspace_id, session_id)

    def view(self, workspace_id: str, session_id: str, cursor_index: int | None = None,
             advance_interval_seconds: int | None = None, cutoff_timestamp: int | None = None) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        payload = record["payload"]
        manifest = self.store.get_dataset(workspace_id, payload['dataset_id'])
        if manifest is None:
            raise LookupError('dataset not found')
        canonical_cursor = int(payload["cursor_index"])
        if cutoff_timestamp is not None:
            if isinstance(cutoff_timestamp, bool) or not isinstance(cutoff_timestamp, int) or cursor_index is not None or advance_interval_seconds is not None:
                raise ValueError('choose a UTC cutoff or a cursor/interval')
            if hasattr(self.artifacts, 'find_dataset_cursor'):
                cursor_index = self.artifacts.find_dataset_cursor(manifest.artifact_path, manifest.artifact_sha256,
                    canonical_cursor=canonical_cursor, timestamp=cutoff_timestamp)
            else:
                _, native = self._dataset_rows(workspace_id, payload['dataset_id'])
                if cutoff_timestamp > int(native[canonical_cursor]['timestamp']):
                    raise ValueError('view cutoff cannot exceed current replay cutoff')
                cursor_index = next(index for index, row in enumerate(native[:canonical_cursor + 1])
                                    if row['timestamp'] >= cutoff_timestamp)
        indexed = hasattr(self.artifacts, 'read_dataset_indices')
        rows = None if indexed else self._dataset_rows(workspace_id, payload['dataset_id'])[1]
        total = manifest.row_count if indexed else len(rows)
        if canonical_cursor >= total:
            raise RuntimeError("replay cursor exceeds immutable dataset")
        bounds = self._period_bounds(payload)
        if bounds and (bounds['end_cursor_index'] >= total or not bounds['start_cursor_index'] <= canonical_cursor <= bounds['end_cursor_index']):
            raise RuntimeError('stored replay cursor exceeds its session period')
        view_cursor = canonical_cursor if cursor_index is None else int(cursor_index)
        if view_cursor < 0:
            raise ValueError("view cursor must be nonnegative")
        if view_cursor > canonical_cursor:
            raise ValueError("view cursor cannot exceed current replay cursor")
        if advance_interval_seconds is not None:
            _, _, view_cursor, _ = self._step_window(workspace_id, payload['dataset_id'], view_cursor,
                1, advance_interval_seconds, limit=canonical_cursor)
        visible_start = max(0, view_cursor - 1999)
        visible = (self.artifacts.read_dataset_indices(manifest.artifact_path, manifest.artifact_sha256,
                   start_index=visible_start, end_index=view_cursor + 1) if indexed
                   else rows[visible_start: view_cursor + 1])
        execution_view_status = "current" if payload.get("execution") else "not_initialized"
        if view_cursor != canonical_cursor and (payload.get("execution") or payload.get("asset_states")):
            try:
                record = self.analytics_record(workspace_id, session_id, cursor_index=view_cursor)
                execution_view_status = "checkpoint"
            except ValueError as exc:
                if str(exc) != "historical analytics checkpoint is unavailable":
                    raise
                record = {**record, "payload": {**payload, "cursor_index": view_cursor, "execution": None}}
                execution_view_status = "unavailable"
        portfolio = {}
        if payload.get('asset_states'):
            from .replay_portfolio import account
            portfolio = {'portfolio_account': account(record['payload'])}
        return {
            **record,
            "dataset_sha256": manifest.artifact_sha256,
            "cutoff_timestamp": int(visible[-1]["timestamp"]),
            "visible_rows": visible,
            "visible_row_count": len(visible),
            "visible_row_start": visible_start,
            "total_row_count": total,
            "has_future_rows": (payload['replay_clock_utc'] < payload['replay_end_utc']) if payload.get('asset_states') else view_cursor < (bounds['end_cursor_index'] if bounds else total - 1),
            "view_cursor_index": view_cursor,
            "canonical_cursor_index": canonical_cursor,
            "historical_view": view_cursor != canonical_cursor,
            "execution_view_status": execution_view_status,
            **({'session_period': {key: value for key, value in payload['session_period'].items() if key != 'asset_bounds'}
                 | {'start_cursor_index': bounds['start_cursor_index'], 'end_cursor_index': bounds['end_cursor_index'],
                    'asset_start_timestamp': bounds['start_timestamp'], 'asset_end_timestamp': bounds['end_timestamp']}} if bounds else {}),
            **portfolio,
        }

    def chart_window(self, workspace_id, session_id, *, dataset_id, dataset_sha256,
                     cursor_index=None, resolution='1', from_utc=None, to_utc=None, count_back=300):
        from .replay_chart_history import MAX_CHART_BARS, chart_period, chart_bucket, prepend_chart_row
        record = self.store.get_record(workspace_id, 'replay', session_id)
        if record is None:
            raise LookupError('replay session not found')
        payload = record['payload']
        if dataset_id != payload['dataset_id']:
            raise ValueError('chart dataset is not the active replay asset')
        manifest = self.store.get_dataset(workspace_id, dataset_id)
        if manifest is None:
            raise LookupError('dataset not found')
        if dataset_sha256 != manifest.artifact_sha256:
            raise ValueError('chart dataset checksum conflicts with replay')
        canonical = int(payload['cursor_index'])
        bounds = self._period_bounds(payload)
        if bounds and canonical > bounds['end_cursor_index']:
            raise RuntimeError('stored replay cursor exceeds its session period')
        cursor = canonical if cursor_index is None else cursor_index
        if isinstance(cursor, bool) or not isinstance(cursor, int) or not 0 <= cursor <= canonical:
            raise ValueError('chart cursor is outside the visible replay range')
        if isinstance(count_back, bool) or not isinstance(count_back, int) or not 1 <= count_back <= MAX_CHART_BARS:
            raise ValueError('chart count_back must be between 1 and 2000')
        if any(isinstance(value, bool) or not isinstance(value, int) for value in (from_utc, to_utc) if value is not None):
            raise ValueError('chart times must be integer UTC timestamps')
        if from_utc is not None and to_utc is not None and from_utc > to_utc:
            raise ValueError('invalid chart time range')
        period = chart_period(resolution, manifest.timeframe_seconds)
        if hasattr(self.artifacts, 'read_dataset_chart_window'):
            window = self.artifacts.read_dataset_chart_window(manifest.artifact_path, manifest.artifact_sha256,
                cursor_index=cursor, period=period, to_utc=to_utc, count_back=count_back)
        else:
            # In-memory/test artifact implementations retain the same bounded output contract.
            _, rows = self._dataset_rows(workspace_id, dataset_id)
            buckets = {}
            for row in reversed(rows[:cursor + 1]):
                time = chart_bucket(row['timestamp'], period)
                if to_utc is None or time < to_utc * 1000:
                    prepend_chart_row(buckets, row, period)
            bars = sorted(buckets.values(), key=lambda bar: bar['time'])
            window = {'bars': bars[-count_back:], 'has_more': len(bars) > count_back,
                      'cutoff_timestamp': int(rows[cursor]['timestamp']), 'total_row_count': len(rows)}
        return {'schema_version': 'replay-chart-window-v1', 'workspace_id': workspace_id,
                'session_id': session_id, 'dataset_id': dataset_id, 'dataset_sha256': dataset_sha256,
                'revision': record['revision'], 'cursor_index': cursor, 'canonical_cursor_index': canonical,
                'resolution': str(resolution), **window}

    def record_activity(self, workspace_id, session_id, body):
        start, end = validate_activity(body)
        return self.store.record_replay_activity(workspace_id, session_id, body.event_id, start, end)

    def step(self, workspace_id: str, session_id: str, expected_revision: int, steps: int = 1,
             replay_interval_seconds: int | None = None) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        if record['payload'].get('asset_states'):
            from .replay_portfolio import step_portfolio
            return step_portfolio(self, workspace_id, record, steps, replay_interval_seconds)
        payload = dict(record["payload"])
        current_cursor = int(payload["cursor_index"])
        bounds = self._period_bounds(payload)
        if bounds and not bounds['start_cursor_index'] <= current_cursor <= bounds['end_cursor_index']:
            raise RuntimeError('stored replay cursor exceeds its session period')
        if bounds and current_cursor >= bounds['end_cursor_index']:
            raise ValueError('selected replay period is completed')
        manifest, rows, cursor, total = self._step_window(workspace_id, payload['dataset_id'], current_cursor, steps, replay_interval_seconds,
            limit=bounds['end_cursor_index'] if bounds else None)
        timing = dict(payload.get("timing") or new_timing(legacy_baseline=True))
        timing["historical_time_replayed_seconds"] += max(0, int(rows[-1]["timestamp"]) - int(rows[0]["timestamp"]))
        payload["timing"] = timing
        execution = self._execution_snapshot(payload)
        execution_events: list[dict] = []
        if execution is not None:
            if execution.cursor_index != current_cursor:
                raise RuntimeError("replay execution cursor is inconsistent with replay state")
            for next_cursor in range(current_cursor + 1, cursor + 1):
                if execution.schema_version == 'replay-execution-tick-v1':
                    from .replay_tick_execution import advance_tick_execution
                    bar = rows[next_cursor - current_cursor]
                    start, end = int(bar['timestamp']) * 1000, (int(bar['timestamp']) + execution.timeframe_seconds) * 1000
                    self.ticks.assert_interval(workspace_id, execution.tick_snapshot_id, start, end)
                    advanced = advance_tick_execution(execution, ticks=self.ticks.iter_ticks(workspace_id, execution.tick_snapshot_id, start, end),
                        bar=bar, cursor_index=next_cursor)
                else:
                    advanced = advance_replay_execution(execution, bar=rows[next_cursor - current_cursor], cursor_index=next_cursor)
                execution = advanced.snapshot
                execution_events.extend(event.model_dump(mode="json") for event in advanced.events)
            payload["execution"] = execution.model_dump(mode="json")
        payload["cursor_index"] = cursor
        payload["status"] = "completed" if cursor == (bounds['end_cursor_index'] if bounds else total - 1) else "paused"
        self._update_payload(workspace_id, session_id, expected_revision, payload)
        result = self.view(workspace_id, session_id)
        result["execution_events"] = execution_events
        return result

    def analytics_record(
        self, workspace_id: str, session_id: str,
        cursor_index: int | None = None, cutoff_timestamp: int | None = None,
        event_sequence: int | None = None,
    ) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        canonical_cursor = int(record["payload"]["cursor_index"])
        if record['payload'].get('asset_states'):
            from .replay_portfolio import checkpoint_portfolio
            return checkpoint_portfolio(self, workspace_id, record, cursor_index, cutoff_timestamp, event_sequence)
        if cursor_index is not None and (isinstance(cursor_index, bool) or not isinstance(cursor_index, int)):
            raise ValueError("analytics cursor must be an integer")
        if cutoff_timestamp is not None:
            if isinstance(cutoff_timestamp, bool) or not isinstance(cutoff_timestamp, int):
                raise ValueError("analytics cutoff must be an integer bar timestamp")
            _, timing = self._dataset_timing(workspace_id, record['payload']['dataset_id'], index=canonical_cursor,
                at_or_before=cutoff_timestamp)
            if not timing['first_utc'] <= cutoff_timestamp <= timing['index_utc']:
                raise ValueError("analytics cutoff is outside the visible replay range")
            cutoff_cursor = timing['cursor_index']
            if cursor_index is not None and cursor_index != cutoff_cursor:
                raise ValueError("analytics cursor and cutoff disagree")
            cursor_index = cutoff_cursor
        selected_cursor = canonical_cursor if cursor_index is None else cursor_index
        if (isinstance(selected_cursor, bool) or not isinstance(selected_cursor, int)
                or not 0 <= selected_cursor <= canonical_cursor):
            raise ValueError("analytics cursor is outside the visible replay range")
        payload = dict(record["payload"])
        snapshot = self._execution_snapshot(payload)
        if event_sequence is not None and (snapshot is None or isinstance(event_sequence, bool)
                or not isinstance(event_sequence, int) or not 0 <= event_sequence <= snapshot.event_sequence):
            raise ValueError("analytics event sequence is outside canonical execution")
        if (selected_cursor < canonical_cursor or event_sequence is not None) and snapshot is not None:
            try:
                checkpoint = self._checkpoint(snapshot, cursor_index=selected_cursor,
                                                                      event_sequence=event_sequence)
            except ReplayExecutionError as exc:
                if str(exc) != "execution branch cursor has no canonical checkpoint":
                    raise ValueError(str(exc)) from exc
                if event_sequence not in (None, 0):
                    raise ValueError("analytics event must select a bar-close or phase checkpoint") from exc
                # Initialization has no price-mark event. Its immutable revision
                # is the only valid fallback; never substitute the current state.
                checkpoint = None
                for prior in reversed(self.store.list_record_revisions(workspace_id, "replay", session_id)):
                    if prior["revision"] <= record["revision"] and prior["payload"].get("cursor_index") == selected_cursor:
                        checkpoint = self._execution_snapshot(prior["payload"])
                        if checkpoint is not None and (event_sequence is None or checkpoint.event_sequence == event_sequence):
                            break
                        checkpoint = None
                if checkpoint is None:
                    raise ValueError("historical analytics checkpoint is unavailable")
            for field in ("replay_session_id", "branch_id", "dataset_id", "dataset_sha256",
                          "instrument_spec", "cost_model", "spread_price", "timeframe_seconds", "starting_balance",
                          "schema_version", "research_margin", "tick_snapshot_id", "tick_snapshot_sha256", "quote_source"):
                if getattr(checkpoint, field, None) != getattr(snapshot, field, None):
                    raise ValueError("historical analytics checkpoint lineage is inconsistent")
            if checkpoint.cursor_index != selected_cursor:
                raise ValueError("historical analytics checkpoint cursor is inconsistent")
            payload["execution"] = checkpoint.model_dump(mode="json")
        payload["cursor_index"] = selected_cursor
        return {**record, "payload": payload, "view_cursor_index": selected_cursor,
                "canonical_cursor_index": canonical_cursor,
                "canonical_execution_event_sequence": snapshot.event_sequence if snapshot else None,
                "historical_view": selected_cursor < canonical_cursor or (
                    event_sequence is not None and event_sequence < snapshot.event_sequence)}

    def analytics_experiments(self, workspace_id, session_id, *, filters=None,
                              cursor_index=None, cutoff_timestamp=None, event_sequence=None, **config):
        from .analytics_experiments import build_replay_experiments

        record = self.analytics_record(workspace_id, session_id, cursor_index, cutoff_timestamp, event_sequence)
        if record['payload'].get('asset_states'):
            raise ValueError('portfolio experiments require an instrument-specific experiment')
        manifest, rows = self._dataset_rows(workspace_id, record["payload"]["dataset_id"])
        return build_replay_experiments({**record, "workspace_id": workspace_id}, rows,
                                       dataset_sha256=manifest.artifact_sha256, filters=filters, **config)

    def branch(self, workspace_id: str, session_id: str, expected_revision: int, cursor_index: int) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        current_cursor = int(record["payload"]["cursor_index"])
        if record['payload'].get('asset_states'):
            from .replay_portfolio import branch_portfolio
            return branch_portfolio(self, workspace_id, record, cursor_index)
        if cursor_index < 0:
            raise ValueError("branch cursor must be nonnegative")
        if cursor_index > current_cursor:
            raise ValueError("branch cursor cannot exceed current replay cursor")
        bounds = self._period_bounds(record['payload'])
        if bounds and cursor_index < bounds['start_cursor_index']:
            raise ValueError('branch cursor is before the selected replay period')
        child_session_id = uuid4().hex
        child_branch_id = uuid4().hex
        configuration = {key: record["payload"][key] for key in ("name", "description", "starting_balance", "starting_balance_ccy", "playbook_id", "playbook_revision", "chart_engine", "session_period") if key in record["payload"]}
        payload = {
            **configuration,
            "dataset_id": record["payload"]["dataset_id"],
            "cursor_index": int(cursor_index),
            "branch_id": child_branch_id,
            "parent_session_id": session_id,
            "parent_revision": int(expected_revision),
            "status": "paused",
            "timing": new_timing(),
        }
        if bounds and cursor_index == bounds['end_cursor_index']:
            payload['status'] = 'completed'
        current_execution = self._execution_snapshot(record["payload"])
        if current_execution is not None:
            checkpoint = None
            checkpoint_revision = None
            checkpoint_source = None
            for historical in reversed(self.store.list_record_revisions(workspace_id, "replay", session_id)):
                if int(historical["revision"]) > int(expected_revision):
                    continue
                historical_payload = historical["payload"]
                if int(historical_payload.get("cursor_index", -1)) != int(cursor_index):
                    continue
                historical_execution = self._execution_snapshot(historical_payload)
                if historical_execution is None:
                    continue
                if historical_execution.cursor_index != int(cursor_index):
                    raise RuntimeError("historical replay execution cursor is inconsistent with replay state")
                checkpoint = historical_execution
                checkpoint_revision = int(historical["revision"])
                checkpoint_source = "record_revision"
                break
            if checkpoint is None:
                try:
                    checkpoint = self._checkpoint(
                        current_execution,
                        cursor_index=int(cursor_index),
                    )
                except ReplayExecutionError as exc:
                    raise ValueError(str(exc)) from exc
                checkpoint_revision = int(expected_revision)
                checkpoint_source = "ledger_price_mark"

            immutable_fields = (
                "replay_session_id",
                "branch_id",
                "dataset_id",
                "dataset_sha256",
                "instrument_spec",
                "cost_model",
                "spread_price",
                "timeframe_seconds",
                "starting_balance",
                "schema_version",
                "research_margin",
                "tick_snapshot_id", "tick_snapshot_sha256", "quote_source",
            )
            for field in immutable_fields:
                if getattr(checkpoint, field, None) != getattr(current_execution, field, None):
                    raise RuntimeError("historical replay execution checkpoint is inconsistent with current lineage")
            try:
                forked_execution = fork_replay_execution_checkpoint(
                    checkpoint,
                    replay_session_id=child_session_id,
                    branch_id=child_branch_id,
                )
            except ReplayExecutionError as exc:
                raise ValueError(str(exc)) from exc
            payload.update(
                {
                    "execution": forked_execution.model_dump(mode="json"),
                    "parent_checkpoint_revision": checkpoint_revision,
                    "parent_checkpoint_event_sequence": checkpoint.event_sequence,
                    "parent_checkpoint_source": checkpoint_source,
                }
            )
        branched = self.store.create_replay_branch_record(
            workspace_id,
            session_id,
            expected_revision,
            child_session_id,
            payload,
        )
        return self.view(workspace_id, branched["record_id"])

    def branch_prop_attempt(
        self,
        workspace_id: str,
        replay_session_id: str,
        *,
        prop_session_id: str,
        parent_attempt_id: str,
        expected_replay_revision: int,
        expected_parent_replay_revision: int,
        expected_parent_attempt_revision: int,
        operation_id: str,
    ) -> dict:
        record = self.store.get_record(workspace_id, 'replay', replay_session_id)
        if record is None:
            raise LookupError('replay session not found')
        if record['payload'].get('asset_states'):
            raise ValueError('multi-asset replay is not supported by Prop lifecycle')
        result = self.store.create_prop_branch_attempt(
            workspace_id,
            replay_session_id,
            prop_session_id=prop_session_id,
            parent_attempt_id=parent_attempt_id,
            expected_replay_revision=expected_replay_revision,
            expected_parent_replay_revision=expected_parent_replay_revision,
            expected_parent_attempt_revision=expected_parent_attempt_revision,
            operation_id=operation_id,
        )
        return {
            "session": result["session"].model_dump(mode="json"),
            "attempt": result["attempt"].model_dump(mode="json"),
            "phase": result["phase"].model_dump(mode="json"),
            "resume_state": result["resume_state"],
            "duplicate": result["duplicate"],
        }

    def feed_prop_lifecycle(
        self,
        workspace_id: str,
        replay_session_id: str,
        *,
        prop_session_id: str,
        prop_attempt_id: str,
        replay_event_sequence: int,
        expected_prop_revision: int,
        prop_event_sequence: int,
    ) -> dict:
        record = self.store.get_record(workspace_id, "replay", replay_session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record['payload'].get('asset_states'):
            raise ValueError('multi-asset replay is not supported by Prop lifecycle')
        snapshot = self._execution_snapshot(record["payload"])
        if snapshot is None:
            raise ValueError("replay execution is not initialized")
        prop_state = self.store.get_prop_resume_state(workspace_id, prop_session_id, prop_attempt_id)
        if prop_state is None:
            raise LookupError("prop attempt not found")
        session = prop_state["session"]
        attempt = prop_state["attempt"]
        phase = prop_state["phase"]
        validate_replay_prop_binding(snapshot, attempt, phase)
        if phase.phase_index > len(session.profile.phases):
            raise ReplayPropConnectionError("prop phase index is outside the frozen profile")

        marks = [
            replay_event_for_snapshot(snapshot, item)
            for item in snapshot.ledger
            if item.get("kind") == "price_mark"
        ]
        selected = next((item for item in marks if item.sequence == replay_event_sequence), None)
        if selected is None:
            raise LookupError("replay price_mark event not found")

        operation_id = replay_event_operation_id(
            replay_session_id=replay_session_id,
            branch_id=snapshot.branch_id,
            replay_event_sequence=selected.sequence,
            prop_session_id=prop_session_id,
            prop_attempt_id=prop_attempt_id,
        )
        prior_mutation = self.store.get_prop_mutation_snapshot(
            workspace_id,
            prop_session_id,
            prop_attempt_id,
            operation_id,
        )

        resume = dict(prop_state["resume_state"] or {})
        binding = resume.get("replay_binding")
        last_replay_event_sequence = 0
        if binding is not None:
            if not isinstance(binding, dict):
                raise ReplayPropConnectionError("prop replay binding is invalid")
            expected_lineage = {
                "replay_session_id": replay_session_id,
                "branch_id": snapshot.branch_id,
                "dataset_id": snapshot.dataset_id,
                "dataset_sha256": snapshot.dataset_sha256,
            }
            for key, expected in expected_lineage.items():
                if binding.get(key) != expected:
                    raise ReplayPropConnectionError("prop attempt is already bound to a different replay lineage")
            last_replay_event_sequence = int(binding.get("last_replay_event_sequence") or 0)

        if replay_event_sequence < last_replay_event_sequence and prior_mutation is None:
            raise ReplayPropConnectionError("replay lifecycle events cannot move backwards")
        if prior_mutation is None and replay_event_sequence > last_replay_event_sequence:
            next_marks = [item.sequence for item in marks if item.sequence > last_replay_event_sequence]
            if not next_marks or replay_event_sequence != min(next_marks):
                raise ReplayPropConnectionError("replay price_mark events must feed prop lifecycle in order")

        event_phase = prior_mutation["phase"] if prior_mutation is not None else phase
        if prior_mutation is None and prop_event_sequence not in {phase.last_event_sequence, phase.last_event_sequence + 1}:
            raise ReplayPropConnectionError("prop event sequence is not the next event or an exact retry")

        prop_event = replay_mark_to_prop_event(
            workspace_id=workspace_id,
            prop_session_id=prop_session_id,
            prop_attempt_id=prop_attempt_id,
            profile_hash=attempt.profile_hash,
            expected_prop_revision=expected_prop_revision,
            prop_event_sequence=prop_event_sequence,
            phase_spec=session.profile.phases[event_phase.phase_index - 1],
            replay_event=selected,
        )
        event_position = selected.details.get("open_position")
        event_pending = selected.details.get("pending_market_order")
        next_resume = dict(prior_mutation["resume_state"] if prior_mutation is not None else resume)
        # The Prop store owns this subtree and excludes caller changes to it.
        # Omitting it keeps an exact retry byte-for-byte stable after the store
        # has written the latest objective evaluation into current resume state.
        next_resume.pop("prop_lifecycle", None)
        next_resume["cursor"] = {
            "bar_index": selected.cursor_index,
            "timestamp_utc": self._iso_utc(selected.virtual_time_utc),
        }
        next_resume["open_positions"] = [event_position] if event_position is not None else []
        next_resume["pending_orders"] = [event_pending] if event_pending is not None else []
        next_resume["replay_binding"] = {
            "replay_session_id": replay_session_id,
            "branch_id": snapshot.branch_id,
            "dataset_id": snapshot.dataset_id,
            "dataset_sha256": snapshot.dataset_sha256,
            "last_replay_event_sequence": selected.sequence,
        }
        result = self.store.apply_prop_lifecycle_event(prop_event, resume_state=next_resume)
        return {
            "replay_event": selected.model_dump(mode="json"),
            "prop_event": prop_event.model_dump(mode="json"),
            "attempt": result["attempt"].model_dump(mode="json"),
            "phase": result["phase"].model_dump(mode="json"),
            "resume_state": result["resume_state"],
            "objectives": result["objectives"],
            "duplicate": result["duplicate"],
        }
