import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from app import CasinoStore, InsufficientCredits, SpinConflict, calculate_win


class CasinoSimulationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.sqlite3"
        self.store = CasinoStore(self.db_path, symbol_picker=lambda: "7")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_server_paytable(self):
        self.assertEqual(calculate_win(["7", "7", "7"], 100), 2500)
        self.assertEqual(calculate_win(["GEM", "GEM", "GEM"], 100), 800)
        self.assertEqual(calculate_win(["BAR", "BAR", "MOON"], 100), 50)
        self.assertEqual(calculate_win(["7", "BAR", "MOON"], 100), 0)

    def test_spin_is_recorded_and_balance_is_updated(self):
        result = self.store.spin("test-spin-0001", 100)
        self.assertEqual(result["symbols"], ["7", "7", "7"])
        self.assertEqual(result["win"], 2500)
        self.assertEqual(result["balance"], 12400)
        self.assertEqual(self.store.state()["player"]["balance"], 12400)
        self.assertEqual(len(self.store.state()["history"]), 1)

    def test_retry_is_idempotent(self):
        first = self.store.spin("test-spin-0002", 100)
        second = self.store.spin("test-spin-0002", 100)
        self.assertEqual(first, second)
        self.assertEqual(len(self.store.state()["history"]), 1)

    def test_reusing_spin_id_for_different_bet_is_rejected(self):
        self.store.spin("test-spin-0003", 100)
        with self.assertRaises(SpinConflict):
            self.store.spin("test-spin-0003", 200)

    def test_bet_limits_are_enforced(self):
        with self.assertRaises(Exception):
            self.store.spin("test-spin-0004", 9)
        with self.assertRaises(Exception):
            self.store.spin("test-spin-0005", 1_010)

    def test_insufficient_credits_do_not_create_a_spin(self):
        self.store.reset_demo()
        with closing(self.store.connect()) as conn:
            conn.execute("UPDATE players SET balance=20 WHERE username='demo'")
        with self.assertRaises(InsufficientCredits):
            self.store.spin("test-spin-0006", 30)
        self.assertEqual(len(self.store.state()["history"]), 0)

    def test_demo_reset_is_audited(self):
        self.store.spin("test-spin-0007", 100)
        response = self.store.reset_demo()
        self.assertEqual(response["balance"], 10_000)
        self.assertEqual(self.store.state()["player"]["balance"], 10_000)
        self.assertEqual(self.store.state()["ledger"][0]["reason"], "DEMO_RESET")


if __name__ == "__main__":
    unittest.main()
