'use client';
// Desktop side panels of the play page (wide screens only, never on touch devices): the run's target,
// stats and controls on the left; the live board (or the duel), the pool and the time left on the right.
// The run engine in PlayClient writes a snapshot into `snap`; the panels read it four times a second.
// Everything here is display only and comes from data the page already has.
import { useEffect, useState, type MutableRefObject } from 'react';
import { GAMES, fmt } from '@podium/shared';
import type { GameKey, RunMode } from '@podium/shared';
import type { StatKey } from '@podium/games';
import { useContent, useT } from '@/i18n/client';
import { endsText } from '@/i18n/content';
import { commonEn } from '@/i18n/dict/common.en';
import { BotChip } from './ui';
import { playEn } from '@/i18n/dict/play.en';

export interface SideSnap {
  score: number;
  /** Seconds of play. */
  t: number;
  stats: { k: StatKey; v: number }[];
  /** Live place on the board (ranked and Cup). */
  place: number;
  /** The HUD's target line and bar (0..100). */
  target: string;
  bar: number;
  /** Other players on the board, best first. */
  rows: { n: string; s: number }[];
  /** Display-only bot benchmarks on this board, best first. Never ranked: they take no place. */
  bots: { n: string; s: number }[];
  best: number;
  duel: { opp: string | null; target: number | null; friend: boolean } | null;
  pool: number | null;
  endAt: string | null;
}

export const emptySnap = (): SideSnap => ({ score: 0, t: 0, stats: [], place: 0, target: '', bar: 0, rows: [], bots: [], best: 0, duel: null, pool: null, endAt: null });

const WIDE = '(min-width: 1100px)';

function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    let q: MediaQueryList;
    try {
      q = matchMedia(WIDE);
    } catch {
      return;
    }
    const f = () => setWide(q.matches && !document.body.classList.contains('touch'));
    f();
    q.addEventListener?.('change', f);
    return () => q.removeEventListener?.('change', f);
  }, []);
  return wide;
}

const mmss = (t: number): string => {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function PlaySide({ side, game, mode, snap }: { side: 'l' | 'r'; game: GameKey; mode: RunMode; snap: MutableRefObject<SideSnap> }) {
  const wide = useWide();
  const [, setTick] = useState(0);
  const t = useT('play', playEn);
  const tc = useT('common', commonEn);
  const gc = useContent().game(game);
  useEffect(() => {
    if (!wide) return;
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [wide]);
  if (!wide) return <aside className={`side s${side}`} aria-hidden="true" />;
  const s = snap.current;
  const g = GAMES[game];
  const ranked = mode === 'ranked' || mode === 'cup';

  if (side === 'l') {
    const fmtStat = (k: StatKey, v: number): string => (k === 'combo' ? 'x' + v : k === 'speed' ? t('unit.kmh', { n: fmt(v) }) : fmt(v));
    return (
      <aside className="side sl" aria-label={g.name}>
        <div className="pc ph">
          <span className="ptag">{gc.tag}</span>
          <h2>{g.name}</h2>
          <span className={`pmode ${mode !== 'practice' ? 'rk' : ''}`}>{t(`mode.${mode}`)}</span>
        </div>
        <div className="pc">
          <small>{t('side.target')}</small>
          <p className="ptarget">{s.target || ' '}</p>
          <i className="gbar">
            <u style={{ width: s.bar + '%' }} />
          </i>
          {!s.duel && (
            <div className="prow">
              <span>{t('side.best')}</span>
              <b className="num">{s.best > 0 ? fmt(s.best) : t('side.noBest')}</b>
            </div>
          )}
        </div>
        <div className="pc">
          <small>{t('side.run')}</small>
          <div className="prow">
            <span>{t('side.score')}</span>
            <b className="num">{fmt(s.score)}</b>
          </div>
          <div className="prow">
            <span>{t('side.time')}</span>
            <b className="num">{mmss(s.t)}</b>
          </div>
          {s.stats.map((st) => (
            <div className="prow" key={st.k}>
              <span>{t(`stat.${st.k}`)}</span>
              <b className="num">{fmtStat(st.k, st.v)}</b>
            </div>
          ))}
        </div>
        <div className="pc pkeys">
          <small>{t('side.controls')}</small>
          {gc.ctl.map((c) => (
            <div key={c[0]}>
              <kbd>{c[0]}</kbd>
              <span>{c[1]}</span>
            </div>
          ))}
          <div>
            <kbd>P</kbd>
            <span>{t('side.pause')}</span>
          </div>
          <div>
            <kbd>F</kbd>
            <span>{t('fullscreen')}</span>
          </div>
          <div>
            <kbd>M</kbd>
            <span>{t('side.sound')}</span>
          </div>
        </div>
      </aside>
    );
  }

  // Right: the duel, or the board with the live run slotted in.
  const d = s.duel;
  let body: JSX.Element;
  if (d) {
    const tgt = d.target;
    body = (
      <div className="pc">
        <small>{t(d.friend ? 'mode.challenge' : 'mode.duel')}</small>
        <div className="pvs">
          <div className="me">
            <span>{t('you')}</span>
            <b className="num">{fmt(s.score)}</b>
          </div>
          <em>vs</em>
          <div>
            <span>{d.opp ?? t('side.waiting')}</span>
            <b className="num">{tgt != null ? fmt(tgt) : '–'}</b>
          </div>
        </div>
        {tgt != null && (
          <>
            <i className="gbar">
              <u style={{ width: Math.min(100, (s.score / Math.max(1, tgt)) * 100) + '%' }} />
            </i>
            <div className="prow">
              <span>{t('side.toBeat')}</span>
              <b className="num">{fmt(tgt)}</b>
            </div>
          </>
        )}
      </div>
    );
  } else {
    const all = s.rows.map((r) => ({ n: r.n, s: r.s, me: false, bot: false }));
    all.push({ n: t('you'), s: s.score, me: true, bot: false });
    // Ties: the player already on the board stays ahead.
    all.sort((a, b) => b.s - a.s || Number(a.me) - Number(b.me));
    // Places count real players only; bot benchmarks slot in by score (a tie goes to the player) with no place.
    const placed = all.map((r, i) => ({ ...r, place: i + 1 }));
    const bots = s.bots.map((r) => ({ n: r.n, s: r.s, me: false, bot: true, place: 0 }));
    const merged = placed.concat(bots).sort((a, b) => b.s - a.s || Number(a.bot) - Number(b.bot));
    const mine = merged.findIndex((r) => r.me);
    const top = merged.slice(0, 5);
    if (mine >= 5) top.push(merged[mine]!);
    body = (
      <div className="pc">
        <small>{t(mode === 'cup' ? 'side.cupBoard' : 'side.board')}</small>
        <table className="pboard">
          <tbody>
            {top.map((r) =>
              r.bot ? (
                <tr key={'bot' + r.n} className="bot" title={tc('bot.title', { name: r.n })}>
                  <td aria-hidden="true">—</td>
                  <td>
                    {r.n}
                    <BotChip label={tc('bot.chip')} />
                  </td>
                  <td className="r">
                    <span className="num">{fmt(r.s)}</span>
                  </td>
                </tr>
              ) : (
                <tr key={(r.me ? 'me' : 'p') + r.place} className={r.me ? 'me' : ''}>
                  <td>{r.place}</td>
                  <td>{r.n}</td>
                  <td className="r">
                    <b className="num">{fmt(r.s)}</b>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        {top.some((r) => r.bot) && <p className="pnote">{t('side.botsNote')}</p>}
        {!s.rows.length && <p className="pnote">{t('side.empty')}</p>}
        {ranked ? (
          <div className="prow big">
            <span>{t('side.place')}</span>
            <b className="num">#{s.place || 1}</b>
          </div>
        ) : (
          <p className="pnote">{t('side.notRanked')}</p>
        )}
      </div>
    );
  }
  return (
    <aside className="side sr" aria-label={t('side.board')}>
      {body}
      {ranked && s.pool != null && (
        <div className="pc">
          <div className="prow big">
            <span>{t('side.pool')}</span>
            <b className="num pool">{t('cost', { n: fmt(s.pool) })}</b>
          </div>
          {s.endAt && (
            <div className="prow">
              <span>{t('side.ends')}</span>
              <b className="num">{endsText(tc, 'short', s.endAt, Date.now())}</b>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
