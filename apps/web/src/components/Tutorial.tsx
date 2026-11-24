'use client';
// First-run "How to play" card for one game, shown over the stage before the run is started
// (before POST /runs, so the server's run clock and the replay timing checks are not affected).
// Only the play page imports this file. Seen state is per game, in localStorage.
import { useEffect, useRef } from 'react';
import { GAMES } from '@podium/shared';
import type { GameKey } from '@podium/shared';

const key = (game: GameKey): string => 'podium.tut.' + game;

/** True when this browser has already dismissed the card for `game` (or storage is unavailable: never nag). */
export function tutorialSeen(game: GameKey): boolean {
  try {
    return localStorage.getItem(key(game)) === '1';
  } catch {
    return true;
  }
}

export function markTutorialSeen(game: GameKey): void {
  try {
    localStorage.setItem(key(game), '1');
  } catch {
    /* private mode: the card may show again next time */
  }
}

export function TutorialCard({ game, onDone }: { game: GameKey; onDone(): void }) {
  const g = GAMES[game];
  const btn = useRef<HTMLButtonElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    btn.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) done.current();
      }
    };
    // Capture phase: the stage's own key handler must not see this key.
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, []);
  return (
    <div className="veil tut on" id="tut" role="dialog" aria-modal="true" aria-labelledby="tutT" onClick={() => done.current()}>
      <div className="rc">
        <small>How to play</small>
        <h3 id="tutT">{g.name}</h3>
        <p>{g.keys}</p>
        <div className="keys">
          {g.ctl.map((c) => (
            <div key={c[0]}>
              <kbd>{c[0]}</kbd>
              <span>{c[1]}</span>
            </div>
          ))}
        </div>
        <button
          className="btn go"
          ref={btn}
          onClick={(e) => {
            e.stopPropagation();
            done.current();
          }}
        >
          Got it
        </button>
        <small className="tutHint">Space, Enter or tap to start</small>
      </div>
    </div>
  );
}
