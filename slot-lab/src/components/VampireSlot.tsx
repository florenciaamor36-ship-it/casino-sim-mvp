import React, { useState, useEffect, useRef, useTransition } from 'react';
import { SlotSpinResult } from '../engines/SlotEngine';
import { VAMPIRE_SKIN } from '../games';
import { SlotSymbolDef } from '../types';

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/slots/vampire`;

const SYMBOL_IMAGE_MAP: Record<string, string> = {
  'vampire-wild': 'vampire-wild.png',
  'blood-moon': 'blood-moon.png',
  'gothic-skull': 'gothic-skull.png',
  'bat': 'bat.png',
  'coffin': 'coffin.png',
  'ruby-gem': 'ruby-gem.png',
  'card-a': 'card-a.png',
  'card-k': 'card-k.png',
  'card-q': 'card-q.png',
  'card-j': 'card-j.png',
};

// Central Audio Controller with synthetic fallbacks and mute toggle support
export class VampireAudioController {
  public play(_kind: 'spin' | 'stop' | 'win' | 'jackpot'): void {}
}

export const vampireAudio = new VampireAudioController();

interface VampireSlotProps {
  balance: number;
  bet: number;
  onBetChange: (newBet: number) => void;
  onSpinRequest: (bet: number) => Promise<{ result: SlotSpinResult; balance: number }>;
  onSpinComplete: (result: SlotSpinResult, balance: number) => void;
  onBusyChange: (busy: boolean) => void;
}

export const VampireSlot: React.FC<VampireSlotProps> = ({
  balance,
  bet,
  onBetChange,
  onSpinRequest,
  onSpinComplete,
  onBusyChange,
}) => {
  const [spinning, setSpinning] = useState(false);
  const [stoppedReels, setStoppedReels] = useState<boolean[]>([true, true, true, true, true]);
  const [grid, setGrid] = useState<SlotSymbolDef[][]>([]);
  const [lastResult, setLastResult] = useState<SlotSpinResult | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [showPaytable, setShowPaytable] = useState(false);
  const [spinError, setSpinError] = useState<string | null>(null);

  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;

  const spinningRef = useRef(spinning);
  spinningRef.current = spinning;

  const balanceRef = useRef(balance);
  balanceRef.current = balance;

  const betRef = useRef(bet);
  betRef.current = bet;

  const handleSpin = async () => {
    if (spinningRef.current || balanceRef.current < betRef.current) {
      if (autoPlayRef.current) setAutoPlay(false);
      return;
    }
    setSpinError(null);
    onBusyChange(true);
    setSpinning(true);
    setStoppedReels([false, false, false, false, false]);
    setLastResult(null);
    vampireAudio.play('spin');
    try {
      const { result, balance: serverBalance } = await onSpinRequest(betRef.current);
      const reelDelays = [400, 650, 900, 1150, 1400];
      reelDelays.forEach((delay, colIndex) => {
        setTimeout(() => {
          setStoppedReels((prev) => {
            const next = [...prev];
            next[colIndex] = true;
            return next;
          });
          vampireAudio.play('stop');
        }, delay);
      });
      setTimeout(() => {
        setGrid(result.grid);
        setLastResult(result);
        setSpinning(false);
        onSpinComplete(result, serverBalance);
        onBusyChange(false);
        if (result.isJackpot) vampireAudio.play('jackpot');
        else if (result.isWin) vampireAudio.play('win');
        if (autoPlayRef.current && serverBalance >= betRef.current) {
          setTimeout(() => { if (autoPlayRef.current) void handleSpin(); }, 1200);
        } else if (autoPlayRef.current && serverBalance < betRef.current) {
          setAutoPlay(false);
        }
      }, 1500);
    } catch (error) {
      setStoppedReels([true, true, true, true, true]);
      setSpinning(false);
      setAutoPlay(false);
      onBusyChange(false);
      setSpinError(error instanceof Error ? error.message : 'No se pudo completar el giro.');
    }
  };

  const toggleAutoPlay = () => {
    const nextState = !autoPlay;
    setAutoPlay(nextState);
    if (nextState && !spinning) {
      handleSpin();
    }
  };

  return (
    <div className="vampire-slot-container" role="region" aria-label="Máquina Tragamonedas Vampiro Demo">
      {/* Gothic Frame Header */}
      <div className="vampire-cabinet-header">
        <img
          src={`${ASSET_BASE}/frames/vampire-logo.png`}
          alt="Vampire: Blood Night Logo"
          className="vampire-cabinet-logo"
        />
        <div className="vampire-demo-badge">MODO DEMO · FICHAS VIRTUALES</div>
      </div>

      {/* Main 5x3 Reel Box */}
      <div
        className="vampire-reels-frame"
        style={{ backgroundImage: `url(${ASSET_BASE}/frames/cabinet-bg.jpg)` }}
      >
        <div className="vampire-reels-container" tabIndex={0} aria-label="Rodillos de slot 5x3">
          {Array.from({ length: 5 }).map((_, col) => {
            const isReelStopped = stoppedReels[col];
            const colSymbols = grid[col] || [];

            const fallbackSymbols = VAMPIRE_SKIN.symbols.slice(0, 3);
            const visibleSymbols = colSymbols.length ? colSymbols : fallbackSymbols;
            const stripSymbols = Array.from({ length: 5 }, () => visibleSymbols).flat();

            return (
              <div
                key={col}
                className={`vampire-reel-column ${!isReelStopped ? 'vampire-reel-spinning' : ''}`}
                style={{ animationDelay: `${col * 0.08}s` }}
              >
                <div className="vampire-reel-track">
                  {stripSymbols.map((sym, index) => {
                    const row = index % 3;
                    const isWinningPos = isReelStopped &&
                      (lastResult?.winningLines.some((wl) =>
                        wl.positions.some((p) => p.col === col && p.row === row)
                      ) ?? false);

                    return (
                      <div
                        key={`${col}-${index}`}
                        className={`vampire-cell ${isWinningPos ? 'vampire-cell-win' : ''}`}
                      >
                        <div className="vampire-symbol-wrapper">
                          <img
                            src={`${ASSET_BASE}/symbols/${SYMBOL_IMAGE_MAP[sym.id] || 'vampire-wild.png'}`}
                            alt={sym.name}
                            className="vampire-symbol-img"
                          />
                          <span className="vampire-symbol-label">{sym.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Hotspot HTML Control Panel */}
        <div className="vampire-control-panel" role="toolbar" aria-label="Controles del juego">
          {/* Bet Minus Hotspot Button */}
          <button
            className="vampire-hotspot vampire-hotspot-minus"
            onClick={() => onBetChange(Math.max(10, bet - 10))}
            disabled={spinning}
            aria-label="Disminuir apuesta"
            title="Disminuir Apuesta"
          >
            −
          </button>

          {/* Bet Display Hotspot */}
          <div className="vampire-hotspot-display vampire-hotspot-bet" aria-live="polite">
            <small>APUESTA</small>
            <span>{bet}</span>
          </div>

          {/* Bet Plus Hotspot Button */}
          <button
            className="vampire-hotspot vampire-hotspot-plus"
            onClick={() => onBetChange(Math.min(1000, bet + 10))}
            disabled={spinning}
            aria-label="Aumentar apuesta"
            title="Aumentar Apuesta"
          >
            +
          </button>

          {/* Main SPIN Button */}
          <button
            className={`vampire-hotspot vampire-hotspot-spin ${spinning ? 'vampire-spin-active' : ''}`}
            onClick={handleSpin}
            disabled={spinning || balance < bet}
            aria-label="Girar rodillos"
          >
            {spinning ? 'GIRANDO…' : 'GIRAR'}
          </button>

          {/* Autoplay Button */}
          <button
            className={`vampire-hotspot vampire-hotspot-auto ${autoPlay ? 'vampire-auto-active' : ''}`}
            onClick={toggleAutoPlay}
            disabled={spinning && !autoPlay}
            aria-label={autoPlay ? 'Detener juego automático' : 'Iniciar juego automático'}
            title="Autoplay"
          >
            {autoPlay ? 'AUTO ON' : 'AUTO'}
          </button>

          {/* Paytable Modal Toggle Button */}
          <button
            className="vampire-hotspot vampire-hotspot-info"
            onClick={() => setShowPaytable(true)}
            aria-label="Ver tabla de pagos"
            title="Tabla de Pagos"
          >
            ℹ️
          </button>

          <button
            className="vampire-hotspot vampire-hotspot-audio vampire-audio-muted"
            disabled
            aria-label="Audio desactivado en esta prueba"
            title="Audio real pendiente; sonidos sintéticos desactivados"
          >🔇</button>
        </div>
      </div>

      {spinError && <p className="vampire-demo-disclaimer" role="alert">{spinError}</p>}

      {/* Paytable Modal */}
      {showPaytable && (
        <div className="vampire-paytable-modal" role="dialog" aria-modal="true" aria-label="Tabla de Pagos Gótica">
          <div className="vampire-paytable-content">
            <button
              className="vampire-paytable-close"
              onClick={() => setShowPaytable(false)}
              aria-label="Cerrar tabla de pagos"
            >
              ×
            </button>
            <h3>📜 TABLA DE PAGOS VAMPÍRICA</h3>
            <p className="vampire-paytable-sub">Pagos multiplicados por apuesta por línea (20 Líneas de pago demo)</p>

            <div className="vampire-paytable-grid">
              {VAMPIRE_SKIN.symbols.map((sym) => (
                <div key={sym.id} className="vampire-paytable-card">
                  <img
                    src={`${ASSET_BASE}/symbols/${SYMBOL_IMAGE_MAP[sym.id]}`}
                    alt={sym.name}
                  />
                  <div>
                    <strong>{sym.name} {sym.isWild ? '(WILD)' : sym.isScatter ? '(SCATTER)' : ''}</strong>
                    <ul>
                      {sym.payouts[5] && <li>5x = {sym.payouts[5]}x</li>}
                      {sym.payouts[4] && <li>4x = {sym.payouts[4]}x</li>}
                      {sym.payouts[3] && <li>3x = {sym.payouts[3]}x</li>}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
            <p className="vampire-demo-disclaimer">
              ⚠️ JUEGO DEMO EDUCATIVO. Sin premios ni transacciones con dinero real.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
