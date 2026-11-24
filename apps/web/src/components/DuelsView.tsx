'use client';
// Duels between real players: pick a game and a stake, POST /duels either joins a waiting duel
// (play against its stored score) or creates one (play now, then wait for an opponent).
import { useEffect, useState } from 'react';
import { ECONOMY, GAMES, GAME_KEYS, duelPayout, fmt, hashName } from '@podium/shared';
import type { DuelView, DuelsResponse, GameKey, GhostEntry } from '@podium/shared';
import { api } from '@/lib/api';
import { useSession } from './Session';
import { Avatar, FramedAvatar } from './ui';

const EMPTY: DuelsResponse = { open: null, waiting: [], history: [], won: 0, lost: 0 };

export function DuelsView({ initial }: { initial: DuelsResponse | null }) {
  const s = useSession();
  const { me } = s;
  const [data, setData] = useState<DuelsResponse>(initial ?? EMPTY);
  const [game, setGame] = useState<GameKey>(initial?.open?.game ?? 'blaster');
  const [stake, setStake] = useState<number>(initial?.open?.stake ?? ECONOMY.duelStakes[1]);
  const [busy, setBusy] = useState(false);
  // Ghosts: real players' best runs this week for the chosen game, playable free as challenges.
  const [ghosts, setGhosts] = useState<{ game: GameKey; list: GhostEntry[] } | null>(null);
  useEffect(() => {
    if (initial) setData(initial);
  }, [initial]);
  useEffect(() => {
    let live = true;
    api.ghosts(game).then(
      (r) => live && setGhosts({ game, list: r.ghosts }),
      () => live && setGhosts({ game, list: [] }),
    );
    return () => {
      live = false;
    };
  }, [game, me?.user.id]);
  const ghostList = ghosts && ghosts.game === game ? ghosts.list : null;
  const chase = (g: GhostEntry) => s.play(game, 'challenge', { code: g.code });
  // The session may have changed (sign-in) since the server render.
  const signedIn = !!me && !me.user.guest;
  useEffect(() => {
    if (signedIn) api.duels().then(setData, () => undefined);
    else setData(EMPTY);
  }, [signedIn]);

  const m: DuelView | null = data.open && data.open.canPlay && data.open.game === game && data.open.stake === stake ? data.open : null;
  const other: DuelView | null = data.open && data.open.canPlay && !m ? data.open : null;
  const u = me?.user;
  const fee = `${Math.round(ECONOMY.fee * 100)}%`;

  const find = async () => {
    if (busy || !s.needAccount()) return;
    if (u && u.balance < stake) {
      s.toast(s.lowText());
      return;
    }
    setBusy(true);
    try {
      const r = await api.createDuel(game, stake);
      s.patchUser({ balance: r.balance });
      setData((d) => ({ ...d, open: r.duel }));
      if (r.role === 'creator') s.toast('No one is waiting at this stake. Play your run and the next player has to beat it.');
      void s.refresh();
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const playDuel = (d: DuelView) => s.play(d.game, 'duel', { duel: d.id });

  return (
    <section className="view on" id="v-duels">
      <h1>Duels</h1>
      <p className="lede">One game, one run, one opponent. Higher score takes the pot.</p>
      <div className="duel">
        <div className="panelx" id="duelL">
          <div className="lbl">Game</div>
          <div className="chips">
            {GAME_KEYS.map((k) => (
              <button key={k} className={k === game ? 'on' : ''} aria-pressed={k === game} onClick={() => setGame(k)}>
                {GAMES[k].name}
              </button>
            ))}
          </div>
          <div className="lbl">Stake</div>
          <div className="chips">
            {ECONOMY.duelStakes.map((v) => (
              <button key={v} className={v === stake ? 'on' : ''} aria-pressed={v === stake} onClick={() => setStake(v)}>
                {v} tChips
              </button>
            ))}
          </div>
          {m ? (
            <>
              <div className="vs">
                <div className="p">
                  <FramedAvatar id={u?.avatar ?? 0} frame={u?.frame ?? 'none'} size={56} />
                  <span>{u?.name}</span>
                  <small>Lv {u?.level ?? 1}</small>
                </div>
                <b className="x">VS</b>
                {m.opponent && m.target != null ? (
                  <div className="p">
                    <Avatar id={hashName(m.opponent)} size={56} />
                    <span>{m.opponent}</span>
                    <small>scored {fmt(m.target)}</small>
                  </div>
                ) : (
                  <div className="p">
                    <span className="ph" aria-hidden="true">
                      ?
                    </span>
                    <span>No opponent yet</span>
                    <small>you play first</small>
                  </div>
                )}
              </div>
              {m.opponent && m.target != null ? (
                <p style={{ margin: '0 0 16px', color: 'var(--soft)' }}>
                  Beat <b style={{ color: 'var(--ink)' }}>{fmt(m.target)}</b> in {GAMES[m.game].name} to win <b style={{ color: 'var(--mint)' }}>{fmt(duelPayout(m.stake))} tChips</b>. One run, winner takes the pot minus the {fee} fee.
                </p>
              ) : (
                <p style={{ margin: '0 0 16px', color: 'var(--soft)' }}>
                  Your {fmt(m.stake)} tChips stake is in. Play your run in {GAMES[m.game].name} now; the next player to pick this game and stake has to beat it. Your stake is refunded if nobody joins within {ECONOMY.duelExpiryHours} hours.
                </p>
              )}
              <div className="cta">
                <button className="btn go" id="dPlay" onClick={() => playDuel(m)}>
                  Play duel <b className="num">{m.stake}</b>
                </button>
              </div>
              {!m.opponent && (
                <div className="ghostsNow">
                  <div className="lbl">Nobody is waiting yet. While you wait, beat a real run</div>
                  <GhostList list={ghostList} limit={3} onPlay={chase} />
                </div>
              )}
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 16px', color: 'var(--soft)' }}>
                You and one opponent each put in the stake. Higher score takes <b style={{ color: 'var(--ink)' }}>{fmt(duelPayout(stake))} tChips</b>.
              </p>
              {other ? (
                <button className="btn go" style={{ width: '100%' }} onClick={() => playDuel(other)}>
                  Play your open duel: {GAMES[other.game].name} <b className="num">{other.stake}</b>
                </button>
              ) : (
                <button className="btn go" id="dFind" style={{ width: '100%' }} onClick={find} disabled={busy}>
                  Find an opponent
                </button>
              )}
            </>
          )}
        </div>
        <div className="duelSide">
        <div className="panelx" id="duelR">
          <h3>Your duels</h3>
          <p style={{ color: 'var(--soft)', margin: '0 0 8px' }}>
            {data.won} won, {data.lost} lost
          </p>
          {data.waiting.length > 0 && (
            <>
              <ul className="dh">
                {data.waiting.map((d) => (
                  <li key={d.id}>
                    <i className="w wt" style={{ fontStyle: 'normal' }} aria-label="Waiting">
                      …
                    </i>
                    <span>
                      <b>{GAMES[d.game].name}</b>, you scored {fmt(d.myScore ?? 0)}
                    </span>
                    <b className="num" style={{ color: 'var(--dim)' }}>
                      {fmt(d.stake)}
                    </b>
                  </li>
                ))}
              </ul>
              <p style={{ color: 'var(--dim)', margin: '6px 0 14px', fontSize: 14 }}>Waiting for an opponent. Your stake is refunded if nobody joins within {ECONOMY.duelExpiryHours} hours.</p>
            </>
          )}
          {data.history.length ? (
            <ul className="dh">
              {data.history.map((d) => (
                <li key={d.id}>
                  <i className={`w ${d.win ? '' : 'l'}`} style={{ fontStyle: 'normal' }}>
                    {d.win ? 'W' : 'L'}
                  </i>
                  <span>
                    <b>{GAMES[d.game].name}</b> vs {d.opponent}, {fmt(d.myScore ?? 0)} to {fmt(d.theirScore ?? 0)}
                  </span>
                  <b className="num" style={{ color: d.win ? 'var(--mint)' : '#d81f5c' }}>
                    {d.amount > 0 ? '+' : ''}
                    {fmt(d.amount)}
                  </b>
                </li>
              ))}
            </ul>
          ) : data.waiting.length ? null : (
            <p style={{ color: 'var(--dim)', margin: '14px 0 0' }}>No duels yet. Pick a game and a stake to start.</p>
          )}
        </div>
        <div className="panelx" id="ghosts">
          <h3>Beat a real run</h3>
          <p className="ghostsSub">
            The best {GAMES[game].name} runs this week, played by real players. Free · XP only.
          </p>
          <GhostList list={ghostList} limit={5} onPlay={chase} />
        </div>
        </div>
      </div>
    </section>
  );
}

/** Real recorded runs to chase. A ghost is another player's accepted run, never a generated one. */
function GhostList({ list, limit, onPlay }: { list: GhostEntry[] | null; limit: number; onPlay(g: GhostEntry): void }) {
  if (!list) return <p className="ghostsEmpty">Loading runs…</p>;
  if (!list.length) return <p className="ghostsEmpty">No runs to chase yet this week. Set the first score.</p>;
  return (
    <ul className="dh ghostList">
      {list.slice(0, limit).map((g) => (
        <li key={g.code}>
          <FramedAvatar id={g.avatar} frame={g.frame} size={30} />
          <span>
            <b>{g.name}</b> · #{g.place}
            <small>Free · XP only</small>
          </span>
          <b className="num">{fmt(g.score)}</b>
          <button className="sbtn" onClick={() => onPlay(g)} aria-label={`Play free against ${g.name}'s ${fmt(g.score)}`}>
            Play free
          </button>
        </li>
      ))}
    </ul>
  );
}
