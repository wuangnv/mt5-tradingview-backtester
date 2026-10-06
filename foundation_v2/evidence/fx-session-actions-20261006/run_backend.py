import os, sys, subprocess, tempfile, time, socket
from pathlib import Path
sys.path.insert(0, str(Path.cwd()/'foundation_v2/scripts'))
from f6_acceptance import free_port, wait_ready
pg=Path('D:/Program Files/PostgreSQL/18/bin')
out=Path('foundation_v2/evidence/fx-session-actions-20261006');out.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='tw-session-actions-') as folder:
 data=Path(folder)/'pg'
 subprocess.run([str(pg/'initdb.exe'),'-D',str(data),'--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'],check=True,capture_output=True)
 port=free_port(); dsn=f'host=127.0.0.1 port={port} user=postgres dbname=postgres'
 server=subprocess.Popen([str(pg/'postgres.exe'),'-D',str(data),'-h','127.0.0.1','-p',str(port)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  wait_ready(dsn,server)
  env=os.environ.copy();env['TW_V2_DATABASE_URL']=dsn;env['TW_V2_ARTIFACT_ROOT']=str(Path(folder)/'artifacts');env['PYTHONPATH']=str(Path.cwd()/'foundation_v2')+os.pathsep+str(Path.cwd())
  cases=['test_replay_session_delete.py','test_ps01_prop_persistence.py','test_ps02_prop_lifecycle.py','test_ps02_replay_prop_connection.py','test_ps03_prop_reports.py','test_chart_annotation_delete.py']
  result=subprocess.run([sys.executable,'-m','pytest','-q',*[str(Path('foundation_v2/tests')/case) for case in cases]],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
  (out/'backend.txt').write_text(result.stdout+result.stderr,encoding='utf-8');print(result.stdout[-9000:]);sys.exit(result.returncode)
 finally:
  subprocess.run([str(pg/'pg_ctl.exe'),'-D',str(data),'stop','-m','fast'],capture_output=True);server.wait(timeout=15)
