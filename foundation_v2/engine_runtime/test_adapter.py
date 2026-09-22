import unittest

from adapter import execute_nautilus


def fixture(direction="both", hold=1):
    spec = {"instrument_id": "EURUSD", "asset_class": "fx", "base_ccy": "EUR", "quote_ccy": "USD", "account_ccy": "USD",
            "tick_size": "0.0001", "contract_size": "100000", "quantity_min": "0.01", "quantity_step": "0.01"}
    protocol = {"dataset": {"instrument_spec": spec, "timeframe_seconds": 3600},
                "playbook": {"rules": {"lookback": 2, "hold_bars": hold, "quantity": 0.1, "direction": direction}},
                "range": {"from_utc": 0, "to_utc": 28800}, "parameters": {"spread_price": 0.0002},
                "starting_balance": 10000, "seed": 7}
    values = [(1,1.01,.99,1), (1,1.02,.995,1.015), (1.015,1.04,1.01,1.035),
              (1.036,1.045,1.02,1.04), (1.04,1.042,1,1.005), (1.004,1.01,.97,.975),
              (.974,.99,.96,.965), (.965,.985,.955,.98)]
    rows = [{"timestamp": i*3600, "open": row[0], "high": row[1], "low": row[2], "close": row[3]}
            for i,row in enumerate(values)]
    return rows, protocol


class NativeAdapterTests(unittest.TestCase):
    def test_library_fills_next_open_not_next_close(self):
        rows, protocol = fixture()
        result = execute_nautilus(rows, protocol)
        fills = result["fills"]
        self.assertEqual([(x["role"], x["side"], x["price"]) for x in fills], [
            ("entry", "BUY", "1.0361"), ("exit", "SELL", "1.0399"),
            ("entry", "SELL", "1.0039"), ("exit", "BUY", "0.9751"),
            ("entry", "SELL", "0.9739"), ("exit", "BUY", "0.9651"),
            ("entry", "SELL", "0.9649"), ("exit", "BUY", "0.9801"),
        ])
        self.assertEqual(fills[0]["timestamp_ns"], 10800*10**9+1)
        self.assertEqual(fills[1]["timestamp_ns"], 14400*10**9)
        self.assertTrue(all(x["units"] == "10000" for x in fills))
        self.assertEqual(result["native_version"], "1.231.0")

    def test_no_signal_has_no_orders(self):
        rows, protocol = fixture()
        for row in rows:
            row.update(open=1, high=1.1, low=.9, close=1)
        self.assertEqual(execute_nautilus(rows, protocol)["fills"], [])

    def test_overlap_and_determinism(self):
        rows, protocol = fixture(hold=2)
        first = execute_nautilus(rows, protocol)
        second = execute_nautilus(rows, protocol)
        self.assertEqual(first, second)
        self.assertEqual(first["signals"]["skipped_overlap"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
