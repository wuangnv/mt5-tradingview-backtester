import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MT5GatewaySerializationTests(unittest.TestCase):
    def test_invalid_bars_error_payload_is_valid_json(self):
        source = (ROOT / "MT5Gateway.mq5").read_text(encoding="utf-8")
        calls = re.finditer(
            r'SendResponse\("(?P<payload>(?:\\.|[^"\\])*)"\);',
            source,
        )
        payload_match = next(
            (
                match
                for match in calls
                if "bars must be between 1 and 100000" in match.group("payload")
            ),
            None,
        )
        self.assertIsNotNone(payload_match, "invalid-bars response must remain explicit")

        # MQL5 uses C-style escaping in the source literal. Decode that literal
        # before parsing so this test exercises the wire payload contract.
        payload = bytes(payload_match.group("payload"), "utf-8").decode("unicode_escape")
        self.assertEqual(
            json.loads(payload),
            {
                "success": False,
                "message": "bars must be between 1 and 100000",
                "data": [],
            },
        )


if __name__ == "__main__":
    unittest.main()
