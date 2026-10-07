import tempfile
import sys
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[2]), str(Path(__file__).resolve().parents[1])]

from trading_workspace_v2.data_ingest import preview_csv, DataImportError

SOURCE = {'source_id':'price-only-test','provider':'local-synthetic-qa','license_use':'qa-only',
          'instrument_mapping':{'EUR-USD':'EUR/USD'},'retrieved_at_utc':'2026-01-01T00:00:00Z','export_settings':'test'}


class PriceOnlyIngestTests(unittest.TestCase):
    def test_price_identifier_does_not_invent_broker_spec_and_boundary_gaps_require_review(self):
        with tempfile.TemporaryDirectory() as folder:
            csv = Path(folder)/'bars.csv'
            csv.write_text('time,open,high,low,close,volume\n60,1,2,1,1,0\n120,1,2,1,1,1\n')
            plain = preview_csv(csv,SOURCE,'EUR/USD',60)
            self.assertEqual(plain['quality']['disposition'],'pass')
            self.assertEqual(plain['instrument'],{'instrument_id':'EUR/USD','metadata_kind':'price_only'})
            checked = preview_csv(csv,SOURCE,'EUR/USD',60,requested_range=(0,240))
            self.assertEqual(checked['quality']['disposition'],'review')
            coverage = checked['quality']['coverage']
            self.assertEqual(coverage['leading_missing_intervals'],1)
            self.assertEqual(coverage['trailing_missing_intervals'],1)
            self.assertEqual(coverage['classification'],'unknown')
            self.assertEqual(checked['quality']['gaps'],[])
            with self.assertRaises(DataImportError):
                preview_csv(csv,SOURCE,'EUR/USD',60,requested_range=(100,240))
            with self.assertRaises(DataImportError):
                preview_csv(csv,SOURCE,'../../EURUSD',60)


if __name__ == '__main__': unittest.main()
