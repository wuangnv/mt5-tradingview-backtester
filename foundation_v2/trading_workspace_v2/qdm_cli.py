"""Local, licensed QuantDataManager CLI bridge; never reads license files."""
from __future__ import annotations

import csv
import io
import re
import subprocess
from pathlib import Path
from datetime import datetime, timezone

from .data_sources import DEFAULT_CAPABILITIES

PROVIDER = 'QuantDataManager'
# Pilot scope: this mapping has been exercised against QDM 125.2692.
INSTRUMENTS = {'EUR/USD': {'code': 'EURUSD', 'startDayForMinuteCandles': '2003-05-05',
                         'name': 'Euro vs US Dollar', 'asset_class': 'fx'}}


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
        self.updated_at = None

    def status(self):
        return {'provider': PROVIDER, 'status': 'cached', 'configured': self.cli.executable.is_file(),
                'refresh_available': True, 'stale': False, 'error': self.error,
                'version': self.cli.version, 'pilot': True, 'asset_count': len(INSTRUMENTS),
                'retrieved_at_utc': self.updated_at}

    def refresh(self):
        try:
            self.cli.probe()
            self.error = None
            self.updated_at = datetime.now(timezone.utc).isoformat()
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
            self.error = str(exc) if isinstance(exc, RuntimeError) else 'qdm_command_failed'

    def list_instruments(self, workspace):
        return [{'instrument_id': symbol, 'provider_code': item['code'], 'provider': PROVIDER,
                 'provider_id': self.provider_id, 'asset_class': item['asset_class'], 'name': item['name']}
                for symbol, item in INSTRUMENTS.items()]

    def list_datasets(self, workspace):
        return []
