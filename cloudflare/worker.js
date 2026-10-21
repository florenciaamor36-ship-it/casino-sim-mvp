const STARTING_CREDITS = 10000;
const MIN_BET = 10;
const MAX_BET = 1000;
const BET_STEP = 10;
const SIMPLE_SYMBOLS = ["7", "BAR", "GEM", "STAR", "MOON", "GEM", "STAR", "MOON", "GEM", "BAR"];
const SIMPLE_MULTIPLIERS = { "7": 25, GEM: 8, BAR: 6, STAR: 4, MOON: 3 };
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{16,80}$/;
const ALLOWED_ORIGINS = new Set([
  "https://florenciaamor36-ship-it.github.io",
  "https://casino-sim-mvp-preview.tiendasshoficial.workers.dev",
]);
const PAYLINES = [
  [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
  [0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[1,0,1,2,1],
  [1,2,1,0,1],[0,1,1,1,0],[2,1,1,1,2],[0,1,0,1,0],[2,1,2,1,2],
  [1,1,0,1,1],[1,1,2,1,1],[0,2,0,2,0],[2,0,2,0,2],[0,0,2,0,0],
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return { "Vary": "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Demo-Session",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function sessionId(request) {
  const header = request.headers.get("X-Demo-Session") || "";
  if (SESSION_RE.test(header)) return header;
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

function newState() { return { balance: STARTING_CREDITS, history: [], ledger: [] }; }
async function readState(env, id) { return (await env.CASINO_KV.get(`player:${id}`, "json")) || newState(); }
async function writeState(env, id, state) { await env.CASINO_KV.put(`player:${id}`, JSON.stringify(state)); }

function validateBet(bet) {
  return Number.isSafeInteger(bet) && bet >= MIN_BET && bet <= MAX_BET && bet % BET_STEP === 0;
}

function validateSkin(skin, gameId) {
  if (!skin || typeof skin !== "object" || skin.id !== gameId || !Array.isArray(skin.symbols)) return "Falta la configuración de la máquina.";
  if (skin.reelsCount !== 5 || skin.rowsCount !== 3 || skin.symbols.length < 3 || skin.symbols.length > 32) return "La máquina debe usar una grilla 5x3 y entre 3 y 32 símbolos.";
  const seen = new Set();
  for (const symbol of skin.symbols) {
    if (!symbol || typeof symbol.id !== "string" || symbol.id.length > 60 || seen.has(symbol.id)) return "La configuración contiene símbolos inválidos.";
    seen.add(symbol.id);
    if (!symbol.payouts || typeof symbol.payouts !== "object") return "Falta la tabla de pagos de un símbolo.";
    for (const count of [3,4,5]) {
      const amount = symbol.payouts[count];
      if (amount !== undefined && (!Number.isFinite(amount) || amount < 0 || amount > 100000)) return "La tabla de pagos contiene un valor inválido.";
    }
  }
  return null;
}

function weightedPool(skin) {
  const pool = [];
  for (const symbol of skin.symbols) {
    let weight = 10;
    if (symbol.isJackpot) weight = 2;
    else if (symbol.isScatter) weight = 3;
    else if (symbol.isWild) weight = 4;
    else if (Number(symbol.payouts[5] || 0) > 50) weight = 6;
    else weight = 12;
    for (let i = 0; i < weight; i++) pool.push(symbol.id);
  }
  return pool;
}

function evaluateSlotLab(skin, bet, requestId) {
  const symbols = skin.symbols;
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const wild = symbols.find((symbol) => symbol.isWild);
  const jackpotSymbol = symbols.find((symbol) => symbol.isJackpot);
  const pool = weightedPool(skin);
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 3 }, () => pool[randomIndex(pool.length)]));
  const winningLines = [];
  const lineBet = bet / PAYLINES.length;

  PAYLINES.forEach((pattern, lineIndex) => {
    const ids = pattern.map((row, col) => grid[col][row]);
    const positions = pattern.map((row, col) => ({ col, row }));
    let baseSymbol = null;
    let matchCount = 0;
    for (const id of ids) {
      const current = byId.get(id);
      if (current?.isScatter) break;
      if (!baseSymbol) {
        if (!current?.isWild) baseSymbol = current || null;
        matchCount++;
      } else if (id === baseSymbol.id || current?.isWild) {
        matchCount++;
      } else {
        break;
      }
    }
    const first = byId.get(ids[0]);
    const evaluated = baseSymbol || wild || first;
    const multiplier = evaluated?.payouts?.[matchCount] || 0;
    if (matchCount >= 3 && multiplier > 0) {
      winningLines.push({
        lineIndex,
        symbolId: evaluated.id,
        count: matchCount,
        multiplier,
        payout: Math.round(lineBet * multiplier),
        positions: positions.slice(0, matchCount),
      });
    }
  });

  let scatterCount = 0;
  for (let col = 0; col < 5; col++) for (let row = 0; row < 3; row++) if (byId.get(grid[col][row])?.isScatter) scatterCount++;
  const isFreeSpinsBonus = scatterCount >= 3;
  const freeSpinsCount = isFreeSpinsBonus ? (scatterCount === 3 ? 10 : scatterCount === 4 ? 15 : 25) : 0;
  const isJackpot = jackpotSymbol ? winningLines.some((line) => line.symbolId === jackpotSymbol.id && line.count >= 5) : false;
  const totalPayout = winningLines.reduce((sum, line) => sum + line.payout, 0);
  const totalMultiplier = bet > 0 ? Number((totalPayout / bet).toFixed(2)) : 0;
  const isWin = totalPayout > 0 || isFreeSpinsBonus;
  let summary = '';
  if (isJackpot) summary = `¡JACKPOT HISTÓRICO! 5 ${jackpotSymbol?.name || 'Símbolos Supremos'} en ${skin.title}!`;
  else if (isFreeSpinsBonus) summary = `¡RONDA DE BONO ACTIVADA! ${scatterCount} Scatters otorgan ${freeSpinsCount} Giros Libres!`;
  else if (isWin) summary = `Premio de ${totalPayout.toLocaleString('es-AR')} fichas (${totalMultiplier}x) en ${winningLines.length} líneas de pago.`;
  else summary = 'Tirada no premiada. ¡El pozo sigue acumulándose!';

  return {
    grid,
    winningLines,
    totalMultiplier,
    totalPayout,
    isWin,
    isJackpot,
    isFreeSpinsBonus,
    freeSpinsCount,
    provablyFairHash: `SIM-${requestId}`,
    summary,
  };
}

async function indexResponse(env, id) {
  const html = await env.CASINO_KV.get("index.html");
  if (!html) return new Response("Demo UI not uploaded", { status: 503 });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Set-Cookie": sessionCookie(id) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = sessionId(request);
    const cors = corsHeaders(request);
    const headers = { ...cors, "Set-Cookie": sessionCookie(id) };
    const reply = (data, status = 200) => json(data, status, headers);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      const origin = request.headers.get("Origin");
      if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403, headers: cors });
      return new Response(null, { status: 204, headers: cors });
    }
    const origin = request.headers.get("Origin");
    if (origin && !ALLOWED_ORIGINS.has(origin) && url.pathname.startsWith("/api/")) return reply({ error: "Origen no autorizado" }, 403);

    if ((url.pathname === "/" || url.pathname === "/index.html") && request.method === "GET") return indexResponse(env, id);
    if (url.pathname === "/api/health" && request.method === "GET") return reply({ ok: true, mode: "simulation", store: "Cloudflare KV demo" });
    if (url.pathname === "/api/state" && request.method === "GET") {
      const state = await readState(env, id);
      return reply({
        mode: "simulation",
        player: { username: "demo", balance: state.balance },
        limits: { minBet: MIN_BET, maxBet: MAX_BET, step: BET_STEP },
        game: { id: "slot-lab", title: "Slot Engine · Prueba técnica" },
        history: state.history || [],
        ledger: state.ledger || [],
      });
    }

    if (request.method === "POST" && url.pathname === "/api/demo/reset") {
      const state = await readState(env, id);
      const adjustment = STARTING_CREDITS - state.balance;
      state.balance = STARTING_CREDITS;
      state.ledger = [{ reason: "DEMO_RESET", amount: adjustment, balance: state.balance, createdAt: new Date().toISOString() }, ...(state.ledger || [])].slice(0, 60);
      await writeState(env, id, state);
      return reply({ balance: state.balance, adjustment, mode: "simulation" });
    }

    if (request.method === "POST" && url.pathname === "/api/spin") {
      let body;
      try { body = await request.json(); } catch { return reply({ error: "JSON inválido" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body) || !REQUEST_ID_RE.test(body.requestId || "")) return reply({ error: "Solicitud de giro inválida" }, 400);
      if (!validateBet(body.bet)) return reply({ error: `La apuesta debe estar entre ${MIN_BET} y ${MAX_BET}, en múltiplos de ${BET_STEP}`, code: "invalid_bet" }, 400);
      const previous = await env.CASINO_KV.get(`simple-spin:${id}:${body.requestId}`, "json");
      if (previous) return reply(previous);
      const state = await readState(env, id);
      if (state.balance < body.bet) return reply({ error: "No alcanzan los créditos virtuales", code: "insufficient_credits" }, 400);
      const symbols = [SIMPLE_SYMBOLS[randomIndex(SIMPLE_SYMBOLS.length)], SIMPLE_SYMBOLS[randomIndex(SIMPLE_SYMBOLS.length)], SIMPLE_SYMBOLS[randomIndex(SIMPLE_SYMBOLS.length)]];
      const counts = symbols.reduce((map, symbol) => (map[symbol] = (map[symbol] || 0) + 1, map), {});
      const match = Object.entries(counts).find(([, count]) => count >= 2);
      const win = symbols.every((symbol) => symbol === symbols[0]) ? body.bet * (SIMPLE_MULTIPLIERS[symbols[0]] || 0) : (match ? Math.floor(body.bet / 2) : 0);
      const balanceAfterBet = state.balance - body.bet;
      const balance = balanceAfterBet + win;
      const createdAt = new Date().toISOString();
      const result = { requestId: body.requestId, gameId: "slot-lab", symbols, bet: body.bet, win, balance, outcome: symbols.every((symbol) => symbol === "7") ? "jackpot" : (win ? "win" : "no_win"), createdAt };
      state.balance = balance;
      state.history = [result, ...(state.history || [])].slice(0, 30);
      state.ledger = [...(win ? [{ reason: "SPIN_WIN", amount: win, balance, createdAt }] : []), { reason: "SPIN_BET", amount: -body.bet, balance: balanceAfterBet, createdAt }, ...(state.ledger || [])].slice(0, 60);
      await writeState(env, id, state);
      await env.CASINO_KV.put(`simple-spin:${id}:${body.requestId}`, JSON.stringify(result), { expirationTtl: 2592000 });
      return reply(result);
    }

    if (request.method === "POST" && url.pathname === "/api/slot-spin") {
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > 65536) return reply({ error: "Solicitud demasiado grande" }, 413);
      let body;
      try { body = await request.json(); } catch { return reply({ error: "JSON inválido" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "El cuerpo debe ser un objeto JSON" }, 400);
      const { gameId, bet, requestId, skin } = body;
      if (typeof gameId !== "string" || !REQUEST_ID_RE.test(requestId || "")) return reply({ error: "Solicitud de giro inválida" }, 400);
      if (!validateBet(bet)) return reply({ error: `La apuesta debe estar entre ${MIN_BET} y ${MAX_BET}, en múltiplos de ${BET_STEP}`, code: "invalid_bet" }, 400);
      const skinError = validateSkin(skin, gameId);
      if (skinError) return reply({ error: skinError, code: "invalid_game" }, 400);
      const idempotencyKey = `slot-spin:${id}:${requestId}`;
      const previous = await env.CASINO_KV.get(idempotencyKey, "json");
      if (previous) {
        if (previous.gameId !== gameId || previous.bet !== bet) return reply({ error: "Ese identificador ya se usó con otros datos", code: "spin_id_conflict" }, 409);
        return reply(previous);
      }
      const state = await readState(env, id);
      if (state.balance < bet) return reply({ error: "No alcanzan los créditos virtuales para esa apuesta", code: "insufficient_credits" }, 400);
      const result = evaluateSlotLab(skin, bet, requestId);
      const balanceAfterBet = state.balance - bet;
      const balance = balanceAfterBet + result.totalPayout;
      const createdAt = new Date().toISOString();
      const response = { requestId, gameId, bet, balance, result, createdAt };
      state.balance = balance;
      state.history = [{ requestId, gameId, bet, win: result.totalPayout, symbols: result.grid, balance, createdAt }, ...(state.history || [])].slice(0, 30);
      state.ledger = [
        ...(result.totalPayout ? [{ reason: "SPIN_WIN", gameId, amount: result.totalPayout, balance, createdAt }] : []),
        { reason: "SPIN_BET", gameId, amount: -bet, balance: balanceAfterBet, createdAt },
        ...(state.ledger || []),
      ].slice(0, 60);
      await writeState(env, id, state);
      await env.CASINO_KV.put(idempotencyKey, JSON.stringify(response), { expirationTtl: 2592000 });
      return reply(response);
    }

    return reply({ error: "No encontrado" }, 404);
  },
};
