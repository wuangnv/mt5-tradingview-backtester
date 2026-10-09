"""Shared, checksum-verified SQL schema authority for Python and Rust."""
from __future__ import annotations

import hashlib
from pathlib import Path

MIGRATION_DIRECTORY = Path(__file__).resolve().parents[1] / "migrations"
MIGRATION_LOCK_KEY = 0x54574D47


def apply_migrations(conn) -> list[str]:
    applied = []
    # Serialize the ledger creation too, including the first startup on an empty DB.
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK_KEY,))
        conn.execute("""CREATE TABLE IF NOT EXISTS tw_schema_migrations (
            version text PRIMARY KEY, sha256 text NOT NULL,
            applied_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        recorded = {row["version"]: row["sha256"] for row in conn.execute(
            "SELECT version,sha256 FROM tw_schema_migrations"
        ).fetchall()}
        files = sorted(MIGRATION_DIRECTORY.glob("[0-9][0-9][0-9][0-9]_*.sql"))
        if not files:
            raise RuntimeError("SQL migration authority is missing")
        if set(recorded) - {path.name for path in files}:
            raise RuntimeError("database schema is newer than this migration authority")
        for path in files:
            raw = path.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if path.name in recorded:
                if recorded[path.name] != digest:
                    raise RuntimeError(f"SQL migration checksum mismatch: {path.name}")
                continue
            conn.execute(raw.decode("utf-8"))
            conn.execute("INSERT INTO tw_schema_migrations(version,sha256) VALUES(%s,%s)",
                         (path.name, digest))
            applied.append(path.name)
    return applied


if __name__ == "__main__":
    import json
    import os
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(os.environ["TW_V2_DATABASE_URL"], row_factory=dict_row) as connection:
        versions = apply_migrations(connection)
    print(json.dumps({"applied": versions}))
