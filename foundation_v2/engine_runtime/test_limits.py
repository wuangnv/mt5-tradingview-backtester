import os
import subprocess
import sys
import unittest
from pathlib import Path


class ProcessLimitTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows Job Objects")
    def test_memory_ceiling_is_enforced_by_os(self):
        code = "from limits import constrain_process\nconstrain_process(256)\ntry:\n data=bytearray(300*1024*1024)\nexcept MemoryError:\n print('limited')\nelse:\n raise SystemExit('memory ceiling was not enforced')"
        result = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).parent,
                                capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "limited")


if __name__ == "__main__":
    unittest.main(verbosity=2)
