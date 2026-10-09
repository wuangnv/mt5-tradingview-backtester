"""Export canonical Pydantic contracts consumed by native stored-data guards."""
import argparse
import json
from pathlib import Path
import sys
from zoneinfo import available_timezones

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT),str(ROOT.parent)]
from trading_workspace_v2.prop_session import PropSessionSnapshot,ChallengeAttemptSnapshot,PhaseStateSnapshot

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    folder=ROOT/'api-rust/contracts'
    values={name+'.schema.json':model.model_json_schema() for name,model in [('prop-session',PropSessionSnapshot),('prop-attempt',ChallengeAttemptSnapshot),('prop-phase',PhaseStateSnapshot)]}
    values['iana-timezones.json']=sorted(available_timezones())
    for name,value in values.items():
        path=folder/name;text=json.dumps(value,indent=2)+'\n'
        if args.check:
            if path.read_text(encoding='utf-8')!=text:raise SystemExit(f'contract differs: {name}')
        else:path.write_text(text,encoding='utf-8')

if __name__=='__main__':main()
