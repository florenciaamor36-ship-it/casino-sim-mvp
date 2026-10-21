import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SlotSpinResult } from './engines/SlotEngine';
import { games } from './games';
import { VampireSlot } from './components/VampireSlot';
import { VampireBigWinOverlay } from './components/VampireBigWinOverlay';
import './style.css';
import { loadServerBalance, requestServerSpin } from './backend';

const CLEOPATRA_ASSET_BASE = `${import.meta.env.BASE_URL}assets/slots/cleopatra`;
const CLEOPATRA_SYMBOLS: Record<string, string> = {
  s0: 'cleopatra-wild', s1: 'eye-of-horus', s2: 'ankh', s3: 'scarab',
  s4: 'coin', s5: 'lotus', wild: 'cleopatra-wild', scatter: 'bonus'
};

class AudioController {
  play(_kind: 'spin' | 'stop' | 'win' | 'jackpot'): void {}
}
const audio = new AudioController();

function CleopatraOverlay({ result, onClose }: { result: SlotSpinResult; onClose: () => void }) {
  return <div className="big-win-overlay" role="dialog" aria-modal="true" aria-label="Premio grande demo">
    <div className="big-win-card">
      <button className="overlay-close" onClick={onClose} aria-label="Cerrar premio">×</button>
      <img src={`${CLEOPATRA_ASSET_BASE}/overlays/golden-jackpot.jpg`} alt="Cleopatra Golden Jackpot" />
      <strong>{result.totalPayout.toLocaleString('es-AR')} fichas</strong>
      <span>PREMIO DEMO · FICHAS VIRTUALES</span>
    </div>
  </div>;
}

function App() {
  const [selected, setSelected] = useState(0);
  const [bet, setBet] = useState(100);
  const [balance, setBalance] = useState(10000);
  const [result, setResult] = useState<SlotSpinResult | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [showBigWin, setShowBigWin] = useState(false);
  const [spinError, setSpinError] = useState<string | null>(null);
  const [vampireBusy, setVampireBusy] = useState(false);

  useEffect(() => {
    let active = true;
    loadServerBalance().then((value) => { if (active) setBalance(value); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const game = games[selected];
  const isVampire = game.id === 'vampire-slot';
  const isCleopatra = game.id === 'demo-slot-1';

  const spin = async () => {
    if (spinning || vampireBusy || balance < bet) return;
    setSpinning(true); setResult(null); setShowBigWin(false); setSpinError(null);
    try {
      const pending = requestServerSpin(game, bet);
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      const response = await pending;
      setBalance(response.balance);
      setResult(response.result);
      audio.play(response.result.isJackpot ? 'jackpot' : response.result.isWin ? 'win' : 'stop');
      if (response.result.isJackpot || response.result.totalMultiplier >= 20) setShowBigWin(true);
    } catch (error) {
      setSpinError(error instanceof Error ? error.message : 'No se pudo completar el giro.');
    } finally {
      setSpinning(false);
    }
  };

  const handleVampireSpinComplete = (spinResult: SlotSpinResult, serverBalance: number) => {
    setBalance(serverBalance);
    setVampireBusy(false);
    setResult(spinResult);
    if (spinResult.isJackpot || spinResult.totalMultiplier >= 20) setShowBigWin(true);
  };

  const grid = result?.grid ?? [];

  return (
    <div className={`app ${isVampire ? 'vampire-app' : isCleopatra ? 'cleopatra-app' : ''}`}>
      <header>
        <b>🎰 SLOT LAB DEMO</b>
        <span>Motor común SlotEngine · fichas virtuales · no dinero real</span>
      </header>
      <main>
        <aside>
          <h2>Máquinas ({games.length})</h2>
          {games.map((g, i) => (
            <button
              className={`machine-nav-btn ${i === selected ? 'active' : ''} ${g.id === 'vampire-slot' ? 'vampire-nav-btn' : ''}`}
              disabled={spinning || vampireBusy}
              onClick={() => {
                setSelected(i);
                setResult(null);
                setShowBigWin(false);
              }}
              key={g.id}
            >
              {g.title}
              <small>{g.subtitle}</small>
            </button>
          ))}
        </aside>

        <section>
          <div className="hero">
            <div className="sparkles">✦ ✧ ✦</div>
            <p>{game.subtitle}</p>
            <h1>{game.title}</h1>
            <span>Motor común SlotEngine · Demo {selected + 1}/{games.length}</span>
          </div>

          {/* Render Dedicated Vampire Slot Machine Component */}
          {isVampire && (
            <VampireSlot
              balance={balance}
              bet={bet}
              onBetChange={setBet}
              onSpinRequest={(amount) => requestServerSpin(game, amount)}
              onBusyChange={setVampireBusy}
              onSpinComplete={handleVampireSpinComplete}
            />
          )}

          {/* Cleopatra Machine */}
          {!isVampire && isCleopatra && (
            <div className="cleopatra-machine" style={{ backgroundImage: `url(${CLEOPATRA_ASSET_BASE}/frames/cabinet-bg.jpg)` }}>
              <img className="cleopatra-logo" src={`${CLEOPATRA_ASSET_BASE}/frames/cleopatra-logo.jpg`} alt="Cleopatra" />
              <div className={`grid cleopatra-grid ${spinning ? 'spinning' : ''} ${result?.isWin ? 'winner' : ''}`}>
                {(grid.length ? grid.flat() : Array.from({ length: 15 }, () => null)).map((s, i) => (
                  <div className="cell" key={i}>
                    {s ? <><img src={`${CLEOPATRA_ASSET_BASE}/symbols/${CLEOPATRA_SYMBOLS[s.id] ?? 'coin'}.png`} alt={s.label} /><small>{s.label}</small></> : '❔'}
                  </div>
                ))}
              </div>
              <img className="control-art" src={`${CLEOPATRA_ASSET_BASE}/frames/control-panel.jpg`} alt="Panel de control Cleopatra" />
              <button className="hotspot hotspot-spin" onClick={spin} disabled={spinning || vampireBusy}>{spinning ? 'GIRANDO…' : 'GIRAR'}</button>
              <button className="hotspot hotspot-minus" onClick={() => setBet((v) => Math.max(10, v - 10))} aria-label="Bajar apuesta">−</button>
              <button className="hotspot hotspot-plus" onClick={() => setBet((v) => Math.min(1000, v + 10))} aria-label="Subir apuesta">+</button>
            </div>
          )}

          {/* Standard Generic Machines */}
          {!isVampire && !isCleopatra && (
            <div className={`grid ${spinning ? 'spinning' : ''} ${result?.isWin ? 'winner' : ''}`}>
              {(grid.length ? grid.flat() : Array.from({ length: 15 }, () => null)).map((s, i) => (
                <div className="cell" key={i} style={{ color: s?.color }}>
                  {s?.emoji ?? '❔'}<small>{s?.label}</small>
                </div>
              ))}
            </div>
          )}

          {/* Controls bar for generic/cleopatra machines */}
          {!isVampire && (
            <div className="controls">
              <span>Saldo demo: <b>{balance.toLocaleString('es-AR')}</b></span>
              <label>
                Apuesta{' '}
                <input
                  type="number"
                  value={bet}
                  min="10"
                  max="1000"
                  step="10"
                  onChange={(e) => setBet(Math.max(10, Number(e.target.value) || 10))}
                  disabled={spinning || vampireBusy}
                />
              </label>
              {!isCleopatra && (
                <button className="spin" onClick={spin} disabled={spinning || vampireBusy}>
                  {spinning ? 'GIRANDO…' : 'GIRAR'}
                </button>
              )}
            </div>
          )}

          {/* Balance display for Vampire machine */}
          {isVampire && (
            <div className="vampire-global-balance-bar">
              <span>Saldo Demo Virtual: <b>{balance.toLocaleString('es-AR')} fichas</b></span>
            </div>
          )}

          <div className={`message ${result?.isWin ? 'win' : ''}`}>
            {spinError ?? result?.summary ?? 'Elegí una máquina y girá para probarla.'}
          </div>

          <p className="note">
            Demo con fichas virtuales. El giro y el saldo se solicitan al servidor; no hay dinero real, usuarios registrados ni premios conectados.
          </p>
        </section>
      </main>

      {/* Overlays */}
      {showBigWin && result && isVampire && (
        <VampireBigWinOverlay result={result} onClose={() => setShowBigWin(false)} />
      )}
      {showBigWin && result && !isVampire && (
        <CleopatraOverlay result={result} onClose={() => setShowBigWin(false)} />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
