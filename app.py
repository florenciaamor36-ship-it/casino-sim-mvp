from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DB_PATH = Path(os.environ.get("DATABASE_PATH", ROOT / "data" / "casino-demo.sqlite3"))
STARTING_CREDITS = 10_000
MIN_BET = 10
MAX_BET = 1_000
BET_STEP = 10

# Demo-only symbols and probabilities. This is not certified game math or an RNG audit.
SYMBOLS = ["7", "BAR", "GEM", "STAR", "MOON", "GEM", "STAR", "MOON", "GEM", "BAR"]
TRIPLE_MULTIPLIERS = {"7": 25, "GEM": 8, "BAR": 6, "STAR": 4, "MOON": 3}
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,80}$")


class CasinoError(Exception):
    status = 400
    code = "invalid_request"


class InsufficientCredits(CasinoError):
    code = "insufficient_credits"


class SpinConflict(CasinoError):
    status = 409
    code = "spin_id_conflict"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def calculate_win(symbols: list[str], bet: int) -> int:
    if len(symbols) != 3:
        raise ValueError("A demo spin needs exactly three symbols")
    if symbols[0] == symbols[1] == symbols[2]:
        return bet * TRIPLE_MULTIPLIERS.get(symbols[0], 0)
    if len(set(symbols)) < 3:
        return bet // 2
    return 0


class CasinoStore:
    def __init__(self, db_path: Path | str = DB_PATH, symbol_picker=None):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.symbol_picker = symbol_picker or (lambda: secrets.choice(SYMBOLS))
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 10000")
        return conn

    def initialize(self) -> None:
        with closing(self.connect()) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS players (
                    id INTEGER PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    balance INTEGER NOT NULL CHECK(balance >= 0),
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS games (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS spins (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id TEXT NOT NULL UNIQUE,
                    player_id INTEGER NOT NULL REFERENCES players(id),
                    game_id TEXT NOT NULL REFERENCES games(id),
                    bet INTEGER NOT NULL,
                    win INTEGER NOT NULL,
                    symbols_json TEXT NOT NULL,
                    balance_after INTEGER NOT NULL,
                    response_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS wallet_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id INTEGER NOT NULL REFERENCES players(id),
                    spin_id INTEGER REFERENCES spins(id),
                    reason TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    balance_after INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )
            conn.execute(
                "INSERT OR IGNORE INTO players(username,balance,created_at) VALUES(?,?,?)",
                ("demo", STARTING_CREDITS, now_iso()),
            )
            conn.execute(
                "INSERT OR IGNORE INTO games(id,title,enabled) VALUES(?,?,1)",
                ("slot-lab", "Slot Engine · Prueba técnica"),
            )

    @staticmethod
    def validate_bet(bet) -> int:
        if isinstance(bet, bool) or not isinstance(bet, int):
            raise CasinoError("La apuesta debe ser un número entero de créditos")
        if bet < MIN_BET or bet > MAX_BET or bet % BET_STEP != 0:
            raise CasinoError(f"La apuesta debe estar entre {MIN_BET} y {MAX_BET}, en múltiplos de {BET_STEP}")
        return bet

    def state(self) -> dict:
        with closing(self.connect()) as conn:
            player = conn.execute("SELECT id,username,balance FROM players WHERE username='demo'").fetchone()
            history = conn.execute(
                "SELECT request_id,bet,win,symbols_json,balance_after,created_at FROM spins WHERE player_id=? ORDER BY id DESC LIMIT 12",
                (player["id"],),
            ).fetchall()
            ledger = conn.execute(
                "SELECT reason,amount,balance_after,created_at FROM wallet_ledger WHERE player_id=? ORDER BY id DESC LIMIT 10",
                (player["id"],),
            ).fetchall()
        return {
            "mode": "simulation",
            "player": {"username": player["username"], "balance": player["balance"]},
            "limits": {"minBet": MIN_BET, "maxBet": MAX_BET, "step": BET_STEP},
            "game": {"id": "slot-lab", "title": "Slot Engine · Prueba técnica"},
            "history": [
                {"requestId": r["request_id"], "bet": r["bet"], "win": r["win"], "symbols": json.loads(r["symbols_json"]), "balance": r["balance_after"], "createdAt": r["created_at"]}
                for r in history
            ],
            "ledger": [
                {"reason": r["reason"], "amount": r["amount"], "balance": r["balance_after"], "createdAt": r["created_at"]}
                for r in ledger
            ],
        }

    def spin(self, request_id: str, bet) -> dict:
        bet = self.validate_bet(bet)
        if not isinstance(request_id, str) or not REQUEST_ID_RE.fullmatch(request_id):
            raise CasinoError("Falta un identificador válido para este giro")

        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("SELECT bet,response_json FROM spins WHERE request_id=?", (request_id,)).fetchone()
            if existing:
                if existing["bet"] != bet:
                    raise SpinConflict("Ese identificador ya se usó con otra apuesta")
                result = json.loads(existing["response_json"])
                conn.commit()
                return result

            player = conn.execute("SELECT id,balance FROM players WHERE username='demo'").fetchone()
            if player is None:
                raise CasinoError("No existe el jugador de demostración")
            if player["balance"] < bet:
                raise InsufficientCredits("No alcanzan los créditos virtuales para esa apuesta")

            symbols = [self.symbol_picker() for _ in range(3)]
            win = calculate_win(symbols, bet)
            balance_after_bet = player["balance"] - bet
            balance_after = balance_after_bet + win
            created_at = now_iso()

            conn.execute("UPDATE players SET balance=? WHERE id=?", (balance_after, player["id"]))
            cursor = conn.execute(
                "INSERT INTO spins(request_id,player_id,game_id,bet,win,symbols_json,balance_after,response_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (request_id, player["id"], "slot-lab", bet, win, json.dumps(symbols), balance_after, "{}", created_at),
            )
            spin_id = cursor.lastrowid
            conn.execute(
                "INSERT INTO wallet_ledger(player_id,spin_id,reason,amount,balance_after,created_at) VALUES(?,?,?,?,?,?)",
                (player["id"], spin_id, "SPIN_BET", -bet, balance_after_bet, created_at),
            )
            if win:
                conn.execute(
                    "INSERT INTO wallet_ledger(player_id,spin_id,reason,amount,balance_after,created_at) VALUES(?,?,?,?,?,?)",
                    (player["id"], spin_id, "SPIN_WIN", win, balance_after, created_at),
                )

            outcome = "jackpot" if symbols == ["7", "7", "7"] else ("win" if win else "no_win")
            result = {
                "requestId": request_id,
                "gameId": "slot-lab",
                "symbols": symbols,
                "bet": bet,
                "win": win,
                "balance": balance_after,
                "outcome": outcome,
                "createdAt": created_at,
            }
            conn.execute("UPDATE spins SET response_json=? WHERE id=?", (json.dumps(result), spin_id))
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def reset_demo(self) -> dict:
        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            player = conn.execute("SELECT id,balance FROM players WHERE username='demo'").fetchone()
            delta = STARTING_CREDITS - player["balance"]
            conn.execute("UPDATE players SET balance=? WHERE id=?", (STARTING_CREDITS, player["id"]))
            conn.execute(
                "INSERT INTO wallet_ledger(player_id,spin_id,reason,amount,balance_after,created_at) VALUES(?,NULL,'DEMO_RESET',?,?,?)",
                (player["id"], delta, STARTING_CREDITS, now_iso()),
            )
            conn.commit()
            return {"balance": STARTING_CREDITS, "adjustment": delta, "mode": "simulation"}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


STORE: CasinoStore | None = None


def get_store() -> CasinoStore:
    global STORE
    if STORE is None:
        STORE = CasinoStore()
    return STORE


class Handler(BaseHTTPRequestHandler):
    server_version = "CasinoSimPreview/0.1"

    def log_message(self, fmt, *args):
        # No cookies, credentials, or request bodies are written to logs.
        print(f"{self.address_string()} - {fmt % args}")

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise CasinoError("Content-Length inválido") from exc
        if length < 0 or length > 16_384:
            raise CasinoError("Solicitud demasiado grande")
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as exc:
            raise CasinoError("JSON inválido") from exc
        if not isinstance(data, dict):
            raise CasinoError("El cuerpo debe ser un objeto JSON")
        return data

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self.send_json(200, {"ok": True, "mode": "simulation"})
        if path == "/api/state":
            return self.send_json(200, get_store().state())
        if path == "/" or path == "/index.html":
            try:
                body = (PUBLIC / "index.html").read_bytes()
            except OSError:
                return self.send_json(500, {"error": "No se encontró la interfaz"})
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        return self.send_json(404, {"error": "No encontrado"})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_json()
            if path == "/api/spin":
                return self.send_json(200, get_store().spin(body.get("requestId"), body.get("bet")))
            if path == "/api/demo/reset":
                return self.send_json(200, get_store().reset_demo())
            return self.send_json(404, {"error": "No encontrado"})
        except CasinoError as exc:
            return self.send_json(exc.status, {"error": str(exc), "code": exc.code})
        except Exception as exc:
            print(f"Unhandled request error: {type(exc).__name__}")
            return self.send_json(500, {"error": "Error interno"})


def main() -> None:
    get_store()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Casino simulation demo listening on port {port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
