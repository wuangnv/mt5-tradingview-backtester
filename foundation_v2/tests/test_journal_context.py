import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trading_workspace_v2.journal_context import build_journal_context
from trading_workspace_v2.store import StoredContractUntrusted
import pytest


def record(source, tags=None, workspace='a'):
    return {'workspace_id': workspace, 'payload': {'source': source, 'tags': tags, 'notes': 'private text'}}


def test_context_aliases_counts_tags_and_scope_without_journal_text():
    result = build_journal_context([
        record({'session_id': 's', 'trade_id': 't', 'id': 't'}, ['risk', 'risk', 1]),
        record({'replay_session_id': 's', 'trade_id': 't', 'id': 'alias'}, ['entry']),
        record({'session_id': 'other', 'trade_id': 't'}, ['ignore']),
    ], 'a', 's')
    assert result['record_count'] == 2
    assert result['trades'] == [
        {'trade_id': 't', 'tags': ['risk', 'entry'], 'record_count': 2},
        {'trade_id': 'alias', 'tags': ['entry'], 'record_count': 1},
    ]
    assert 'private text' not in str(result)


def test_context_empty_is_known_zero_but_cross_workspace_is_untrusted():
    assert build_journal_context([], 'a', 's')['record_count'] == 0
    with pytest.raises(StoredContractUntrusted):
        build_journal_context([record({'session_id': 's'}, workspace='b')], 'a', 's')
