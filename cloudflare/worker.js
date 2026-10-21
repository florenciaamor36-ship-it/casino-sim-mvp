const STARTING_CREDITS = 10000;
const MIN_BET = 10;
const MAX_BET = 1000;
const BET_STEP = 10;
const SYMBOLS = ["7", "BAR", "GEM", "STAR", "MOON", "GEM", "STAR", "MOON", "GEM", "BAR"];
const TRIPLE_MULTIPLIERS = { "7": 25, GEM: 8, BAR: 6, STAR: 4, MOON: 3 };
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function sessionId(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)casino_demo=([0-9a-f-]{36})(?:;|$)/i);
  return match ? match[1].toLowerCase() : crypto.randomUUID();
}

function sessionCookie(id) {
  return `casino_demo=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

function randomIndex(limit) {
  const range = 0x100000000;
  const cutoff = range - (range % limit);
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= cutoff);
  return value[0] % limit;
}

function calculateWin(symbols, bet) {
  if (symbols[0] === symbols[1] && symbols[1] === symbols[2]) return bet * (TRIPLE_MULTIPLIERS[symbols[0]] || 0);
  if (new Set(symbols).size < 3) return Math.floor(bet / 2);
  return 0;
}

function newState() {
  return { balance: STARTING_CREDITS, history: [], ledger: [] };
}

async function readState(env, id) {
  return (await env.CASINO_KV.get(`player:${id}`, "json")) || newState();
}

async function writeState(env, id, state) {
  await env.CASINO_KV.put(`player:${id}`, JSON.stringify(state));
}

async function indexResponse(env) {
  const html = await env.CASINO_KV.get("ui:index.html");
  if (!html) return new Response("Demo UI not uploaded", { status: 503 });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = sessionId(request);
    const cookieHeader = { "Set-Cookie": sessionCookie(id) };

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const response = await indexResponse(env);
      response.headers.set("Set-Cookie", sessionCookie(id));
      return response;
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, mode: "simulation", store: "Cloudflare KV demo" }, 200, cookieHeader);
    }
    if (url.pathname === "/api/state" && request.method === "GET") {
      const state = await readState(env, id);
      return json({
        mode: "simulation",
        player: { username: "demo", balance: state.balance },
        limits: { minBet: MIN_BET, maxBet: MAX_BET, step: BET_STEP },
        game: { id: "slot-lab", title: "Slot Engine · Prueba técnica" },
        history: state.history || [],
        ledger: state.ledger || [],
      }, 200, cookieHeader);
    }

    if (request.method === "POST" && (url.pathname === "/api/spin" || url.pathname === "/api/demo/reset")) {
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > 16384) return json({ error: "Solicitud demasiado grande" }, 413, cookieHeader);
      let body;
      try { body = await request.json(); } catch { return json({ error: "JSON inválido" }, 400, cookieHeader); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "El cuerpo debe ser un objeto JSON" }, 400, cookieHeader);

      if (url.pathname === "/api/demo/reset") {
        const state = await readState(env, id);
        const adjustment = STARTING_CREDITS - state.balance;
        state.balance = STARTING_CREDITS;
        state.ledger = [{ reason: "DEMO_RESET", amount: adjustment, balance: state.balance, createdAt: new Date().toISOString() }, ...(state.ledger || [])].slice(0, 30);
        await writeState(env, id, state);
        return json({ balance: state.balance, adjustment, mode: "simulation" }, 200, cookieHeader);
      }

      const { requestId, bet } = body;
      if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) return json({ error: "Falta un identificador válido para este giro", code: "invalid_request" }, 400, cookieHeader);
      if (!Number.isSafeInteger(bet) || bet < MIN_BET || bet > MAX_BET || bet % BET_STEP !== 0) return json({ error: `La apuesta debe estar entre ${MIN_BET} y ${MAX_BET}, en múltiplos de ${BET_STEP}`, code: "invalid_bet" }, 400, cookieHeader);

      const idempotencyKey = `spin:${id}:${requestId}`;
      const previous = await env.CASINO_KV.get(idempotencyKey, "json");
      if (previous) {
        if (previous.bet !== bet) return json({ error: "Ese identificador ya se usó con otra apuesta", code: "spin_id_conflict" }, 409, cookieHeader);
        return json(previous, 200, cookieHeader);
      }

      const state = await readState(env, id);
      if (state.balance < bet) return json({ error: "No alcanzan los créditos virtuales para esa apuesta", code: "insufficient_credits" }, 400, cookieHeader);
      const symbols = [SYMBOLS[randomIndex(SYMBOLS.length)], SYMBOLS[randomIndex(SYMBOLS.length)], SYMBOLS[randomIndex(SYMBOLS.length)]];
      const win = calculateWin(symbols, bet);
      const balanceAfterBet = state.balance - bet;
      const balance = balanceAfterBet + win;
      const createdAt = new Date().toISOString();
      const result = { requestId, gameId: "slot-lab", symbols, bet, win, balance, outcome: symbols.join("") === "777" ? "jackpot" : (win ? "win" : "no_win"), createdAt };
      state.balance = balance;
      state.history = [result, ...(state.history || [])].slice(0, 30);
      state.ledger = [
        ...(win ? [{ reason: "SPIN_WIN", amount: win, balance, createdAt }] : []),
        { reason: "SPIN_BET", amount: -bet, balance: balanceAfterBet, createdAt },
        ...(state.ledger || []),
      ].slice(0, 60);
      await writeState(env, id, state);
      await env.CASINO_KV.put(idempotencyKey, JSON.stringify(result), { expirationTtl: 2592000 });
      return json(result, 200, cookieHeader);
    }

    return json({ error: "No encontrado" }, 404, cookieHeader);
  },
};
