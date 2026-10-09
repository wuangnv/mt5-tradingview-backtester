import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Header, HTTPException, Query
import psycopg
from psycopg_pool import ConnectionPool

DATA = [{'id': i, 'symbol': 'EURUSD' if i % 3 == 0 else 'XAUUSD', 'pnl_cents': (i * 17) % 20001 - 10000}
        for i in range(1, 100001) if i % 2 == 1]
pool = None
SQL = Path(__file__).with_name('query.sql').read_text()

@asynccontextmanager
async def lifespan(app):
    global pool
    pool = ConnectionPool(f"host=127.0.0.1 port={os.environ['DB_PORT']} user=bench dbname=postgres", min_size=2, max_size=2, kwargs={'autocommit':True})
    pool.wait()
    yield
    pool.close()

app = FastAPI(lifespan=lifespan)

def scope(value):
    if value != 'tenant-a': raise HTTPException(403, 'workspace_access_denied')

@app.get('/json')
def small(x_workspace_id: str = Header(default='')):
    scope(x_workspace_id)
    return {'ok': True, 'scope': 'tenant-a'}

def parameters(rows, page):
    if rows not in (10000, 100000) or not 1 <= page <= 100:
        raise HTTPException(400, 'parameters_invalid')

@app.get('/trades')
def trades(rows: int = 100000, page: int = 1, x_workspace_id: str = Header(default='')):
    scope(x_workspace_id); parameters(rows, page)
    selected = [item for item in DATA if item['id'] <= rows and item['symbol'] == 'EURUSD']
    selected.sort(key=lambda item: (-item['pnl_cents'], item['id']))
    return {'total': len(selected), 'items': selected[(page-1)*25:page*25]}

@app.get('/db')
def database(rows: int = 100000, page: int = 1, x_workspace_id: str = Header(default='')):
    scope(x_workspace_id); parameters(rows, page)
    sql = SQL.format(rows=rows, offset=(page-1)*25)
    with pool.connection() as conn:
        result = conn.execute(sql).fetchall()
    return {'total': result[0][3] if result else 0,
            'items': [{'id': r[0], 'symbol': r[1], 'pnl_cents': r[2]} for r in result if r[0] is not None]}
