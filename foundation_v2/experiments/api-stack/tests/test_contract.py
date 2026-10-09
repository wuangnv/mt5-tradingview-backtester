"""Verify benchmark totals/order and owned-process isolation before trusting timing."""
import importlib.util
from copy import deepcopy
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('stack_run',ROOT/'run.py')
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class BenchmarkContract(unittest.TestCase):
    def test_empty_page_retains_scope_total(self):
        self.assertEqual(runner.expected(10000,100),{'total':1667,'items':[]})

    def test_data_scope_and_tie_order(self):
        page=runner.expected(100000,1)
        self.assertEqual(page['total'],16667)
        self.assertEqual(len(page['items']),25)
        self.assertTrue(all(t['id']%2==1 and t['symbol']=='EURUSD' for t in page['items']))
        ordered=[(-t['pnl_cents'],t['id']) for t in page['items']]
        self.assertEqual(ordered,sorted(ordered))
        self.assertEqual(len({t['id'] for t in page['items']}),25)

    def test_pages_are_disjoint_and_do_not_modify_fixture(self):
        before=deepcopy(runner.DATA)
        first=runner.expected(100000,1)['items']
        second=runner.expected(100000,2)['items']
        self.assertFalse({x['id'] for x in first}&{x['id'] for x in second})
        self.assertEqual(runner.DATA,before)

    def test_commands_do_not_accept_existing_database_or_public_host(self):
        for command in runner.commands().values():
            self.assertNotIn('0.0.0.0',command)
            self.assertNotIn('TW_V2_DATABASE_URL',command)
        self.assertFalse(set(runner.SERVER_CORES)&set(runner.CLIENT_CORES))


if __name__=='__main__':unittest.main()
