import type { SlotSkin } from './types';
import type { PaylineWin, SlotSpinResult } from './engines/SlotEngine';

const API_BASE = import.meta.env.VITE_BACKEND_URL || 'https://casino-sim-mvp-preview.tiendasshoficial.workers.dev';
const SESSION_KEY = 'casino-sim-demo-session';

function getSessionId(): string {
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,80}$/.test(existing)) return existing;
    const fresh = window.crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return window.crypto.randomUUID();
  }
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), 'X-Demo-Session': getSessionId() },
    credentials: 'omit',
    cache: 'no-store',
  });
}

export async function loadServerBalance(): Promise<number> {
  const response = await apiFetch('/api/state');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'No se pudo leer el saldo del servidor.');
  return Number(payload.player.balance);
}

type WireLine = Omit<PaylineWin, 'symbol'> & { symbolId: string };
type WireResult = Omit<SlotSpinResult, 'grid' | 'winningLines'> & {
  grid: string[][];
  winningLines: WireLine[];
};

export async function requestServerSpin(skin: SlotSkin, bet: number): Promise<{ result: SlotSpinResult; balance: number }> {
  const requestId = window.crypto.randomUUID();
  const skinConfig = { id: skin.id, title: skin.title, reelsCount: skin.reelsCount, rowsCount: skin.rowsCount, symbols: skin.symbols };
  const body = JSON.stringify({ gameId: skin.id, bet, requestId, skin: skinConfig });
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await apiFetch('/api/slot-spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      break;
    } catch (error) {
      if (attempt === 1) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
  }
  if (!response) throw new Error('No hubo respuesta del servidor.');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'El servidor rechazó el giro.');

  const byId = new Map(skin.symbols.map((symbol) => [symbol.id, symbol]));
  const wire = payload.result as WireResult;
  const grid = wire.grid.map((column) => column.map((id) => {
    const symbol = byId.get(id);
    if (!symbol) throw new Error(`El servidor devolvió un símbolo desconocido: ${id}`);
    return symbol;
  }));
  const winningLines: PaylineWin[] = wire.winningLines.map((line) => {
    const { symbolId, ...lineData } = line;
    const symbol = byId.get(symbolId);
    if (!symbol) throw new Error(`El servidor devolvió una línea con símbolo desconocido: ${symbolId}`);
    return { ...lineData, symbol };
  });
  const result: SlotSpinResult = { ...wire, grid, winningLines };
  return { result, balance: Number(payload.balance) };
}
