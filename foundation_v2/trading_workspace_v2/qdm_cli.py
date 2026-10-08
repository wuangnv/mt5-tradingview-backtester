"""Local, licensed QuantDataManager CLI bridge; never reads license files."""
from __future__ import annotations

import csv
import hashlib
import io
import re
import subprocess
from pathlib import Path
from datetime import datetime, timezone

from .data_sources import DEFAULT_CAPABILITIES

PROVIDER = 'QuantDataManager'
CATALOG_PATH = Path('internal/plugins/DataSourceDukascopy/dukascopy.csv')


def parse_catalog(raw):
    # QDM's installed definitions use Windows-1252; newer installations may use UTF-8.
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = raw.decode('cp1252')
    instruments = {}
    classes = {'Forex': 'fx', 'Stocks': 'stock', 'Indices': 'index', 'Crypto': 'crypto', 'Bond': 'bond'}
    commodities = {'Energy': 'energy', 'Metals': 'metal', 'Soft': 'agriculture'}
    for row in csv.reader(io.StringIO(text), delimiter=';'):
        if not row or all(not cell.strip() for cell in row):
            continue
        if len(row) != 12:
            raise ValueError('invalid_catalog')
        code, name, category, group, tick_start, minute_start = [cell.strip() for cell in row[:6]]
        if not re.fullmatch(r'[A-Z0-9]+', code) or not name:
            raise ValueError('invalid_catalog')
        tick_start = datetime.strptime(tick_start, '%d.%m.%Y').date().isoformat()
        minute_start = datetime.strptime(minute_start, '%d.%m.%Y').date().isoformat()
        asset_class = commodities.get(group) if category == 'Commodities' else classes.get(category)
        if category == 'Forex' and group == 'Metals':
            asset_class = 'metal'
        if not asset_class:
            raise ValueError('invalid_catalog')
        symbol = f'{code[:3]}/{code[3:]}' if category == 'Forex' and len(code) == 6 else code
        if symbol in instruments:
            raise ValueError('invalid_catalog')
        instruments[symbol] = {'code': code, 'name': name, 'asset_class': asset_class,
                               'source_category': category, 'source_group': group,
                               'startDayForMinuteCandles': minute_start, 'startDayForTicks': tick_start}
    if not instruments:
        raise ValueError('invalid_catalog')
    return instruments


def cli_error(output):
    text = output.lower()
    if 'another instance of quantdatamanager is running' in text:
        return 'qdm_busy'
    if 'missing license' in text or 'invalid license' in text or 'license expired' in text:
        return 'qdm_license_required'
    if re.search(r'(?im)^.*(?:\berror\b|exception|update failed|export failed|unknown symbol).*$', output):
        return 'qdm_command_failed'
    return None


class QdmCli:
    def __init__(self, home):
        self.home = Path(home).resolve()
        self.executable = self.home / 'qdmcli.exe'
        self.version = None

    def run(self, arguments, *, on_line=None, timeout=None):
        if not self.executable.is_file():
            raise RuntimeError('qdm_not_configured')
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        command = [str(self.executable), *arguments]
        if timeout is not None:
            result = subprocess.run(command, cwd=self.home, capture_output=True, text=True,
                                    encoding='utf-8', errors='replace', timeout=timeout, creationflags=flags)
            output, code = result.stdout, result.returncode
        else:
            # The CLI owns QDM's data files. Do not terminate it midway through a write.
            with subprocess.Popen(command, cwd=self.home, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                  text=True, encoding='utf-8', errors='replace', creationflags=flags) as process:
                lines = []
                stream_error = None
                for line in process.stdout:
                    stream_error = stream_error or cli_error(line)
                    if on_line:
                        on_line(line)
                    lines.append(line[:20000])
                    if len(lines) > 500:
                        lines.pop(0)
                output, code = ''.join(lines), process.wait()
        error = cli_error(output) if timeout is not None else stream_error or cli_error(output)
        if error or code != 0 or 'Exit app - ok' not in output:
            raise RuntimeError(error or 'qdm_command_failed')
        return output

    def probe(self):
        output = self.run(['-h'], timeout=45)
        match = re.search(r'App version:\s*([\d.]+)', output)
        if not match or 'cIncludeHeader' not in output or 'cFormat' not in output:
            raise RuntimeError('qdm_version_unsupported')
        self.version = match.group(1)
        return self.version

    def symbols(self):
        output = self.run(['-symbol', 'action=list'], timeout=45)
        header = 'Symbol,Instrument,Timeframe,Timezone,Date from,Date to,Total days,Total records,Source,Data type'
        if header not in output:
            raise RuntimeError('qdm_command_failed')
        table = output[output.index(header):].split('Data listed.', 1)[0]
        return list(csv.DictReader(io.StringIO(table)))


class QdmCatalog:
    provider_id = 'qdm-catalog'
    capabilities = dict(DEFAULT_CAPABILITIES)
    readiness = {'source_kind': 'provider_metadata', 'connection_mode': 'local_cli', 'network_access': True,
                 'oauth_required': False, 'entitlement_status': 'local_license_required', 'production_ready': False}

    def __init__(self, cli):
        self.cli = cli
        self.error = None
        self.snapshot = {'instruments': {}, 'source_sha256': None, 'updated_at': None}

    @property
    def instruments(self):
        return self.snapshot['instruments']

    @property
    def source_sha256(self):
        return self.snapshot['source_sha256']

    @property
    def updated_at(self):
        return self.snapshot['updated_at']

    def status(self):
        return {'provider': PROVIDER, 'data_source': 'Dukascopy', 'download_engine': PROVIDER,
                'integration': 'cli', 'status': 'cached' if self.instruments else 'unavailable',
                'configured': self.cli.executable.is_file(),
                'refresh_available': self.cli.executable.is_file(), 'stale': bool(self.error and self.instruments), 'error': self.error,
                'version': self.cli.version, 'pilot': False, 'asset_count': len(self.instruments),
                'upstream_provider': 'Dukascopy', 'refresh_scope': 'installed_definitions',
                'source_sha256': self.source_sha256,
                'retrieved_at_utc': self.updated_at}

    def refresh(self):
        try:
            raw = (self.cli.home / CATALOG_PATH).read_bytes()
            instruments = parse_catalog(raw)
            # Publish a complete validated replacement; failed refresh keeps the last good catalog.
            self.snapshot = {'instruments': instruments, 'source_sha256': hashlib.sha256(raw).hexdigest(),
                             'updated_at': datetime.now(timezone.utc).isoformat()}
            self.error = None
        except OSError:
            self.error = 'qdm_catalog_missing'
        except (ValueError, UnicodeError, csv.Error):
            self.error = 'qdm_catalog_invalid'

    def list_instruments(self, workspace):
        return [{'instrument_id': symbol, 'provider_code': item['code'], 'provider': PROVIDER,
                 'data_source': 'Dukascopy', 'download_engine': PROVIDER,
                 'provider_id': self.provider_id, 'asset_class': item['asset_class'], 'name': item['name'],
                 'source_category': item['source_category'], 'source_group': item['source_group'],
                 'available_from_date': item['startDayForMinuteCandles'],
                 'tick_available_from_date': item['startDayForTicks']}
                for symbol, item in self.instruments.items()]

    def list_datasets(self, workspace):
        return []
