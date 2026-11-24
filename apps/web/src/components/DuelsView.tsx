'use client';
// Duels between real players: pick a game and a stake, POST /duels either joins a waiting duel
// (play against its stored score) or creates one (play now, then wait for an opponent).
import { useEffect, useState } from 'react';
import { ECONOMY, GAMES, GAME_KEYS, duelPayout, fmt, hashName } from '@podium/shared';
import type { DuelView, DuelsResponse, GameKey, GhostEntry } from '@podium/shared';
import { api } from '@/lib/api';
import { useT } from '@/i18n/client';
import { duelsEn } from '@/i18n/dict/duels.en';
import { useSession } from './Session';
import { Avatar, FramedAvatar } from './ui';

const EMPTY: DuelsResponse = { open: null, waiting: [], history: [], won: 0, lost: 0 };

export function DuelsView({ initial }: { initial: DuelsResponse | null }) {
  const s = useSession();
  const { me } = s;
  const t = useT('duels', duelsEn);
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
      if (r.role === 'creator') s.toast(t('creator'));
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
      <h1>{t('title')}</h1>
      <p className="lede">{t('lede')}</p>
      <div className="duel">
        <div className="panelx" id="duelL">
          <div className="lbl">{t('game')}</div>
          <div className="chips">
            {GAME_KEYS.map((k) => (
              <button key={k} className={k === game ? 'on' : ''} aria-pressed={k === game} onClick={() => setGame(k)}>
                {GAMES[k].name}
              </button>
            ))}
          </div>
          <div className="lbl">{t('stake')}</div>
          <div className="chips">
            {ECONOMY.duelStakes.map((v) => (
              <button key={v} className={v === stake ? 'on' : ''} aria-pressed={v === stake} onClick={() => setStake(v)}>
                {t('stakeChip', { n: v })}
              </button>
            ))}
          </div>
          {m ? (
            <>
              <div className="vs">
                <div className="p">
                  <FramedAvatar id={u?.avatar ?? 0} frame={u?.frame ?? 'none'} size={56} />
                  <span>{u?.name}</span>
                  <small>{t('lv', { n: u?.level ?? 1 })}</small>
                </div>
                <b className="x">{t('vs')}</b>
                {m.opponent && m.target != null ? (
                  <div className="p">
                    <Avatar id={hashName(m.opponent)} size={56} />
                    <span>{m.opponent}</span>
                    <small>{t('scored', { n: fmt(m.target) })}</small>
                  </div>
                ) : (
                  <div className="p">
                    <span className="ph" aria-hidden="true">
                      ?
                    </span>
                    <span>{t('noOpp')}</span>
                    <small>{t('youFirst')}</small>
                  </div>
                )}
              </div>
              {m.opponent && m.target != null ? (
                <p style={{ margin: '0 0 16px', color: 'var(--soft)' }}>
                  {t.rich('beat', {
                    target: <b style={{ color: 'var(--ink)' }}>{fmt(m.target)}</b>,
                    game: GAMES[m.game].name,
                    win: <b style={{ color: 'var(--mint)' }}>{t('winAmount', { n: fmt(duelPayout(m.stake)) })}</b>,
                    fee,
                  })}
                </p>
              ) : (
                <p style={{ margin: '0 0 16px', color: 'var(--soft)' }}>
                  {t('stakeIn', { n: fmt(m.stake), game: GAMES[m.game].name, h: ECONOMY.duelExpiryHours })}
                </p>
              )}
              <div className="cta">
                <button className="btn go" id="dPlay" onClick={() => playDuel(m)}>
                  {t('play')} <b className="num">{m.stake}</b>
                </button>
              </div>
              {!m.opponent && (
                <div className="ghostsNow">
                  <div className="lbl">{t('nobody')}</div>
                  <GhostList list={ghostList} limit={3} onPlay={chase} />
                </div>
              )}
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 16px', color: 'var(--soft)' }}>
                {t.rich('how', { pot: <b style={{ color: 'var(--ink)' }}>{t('winAmount', { n: fmt(duelPayout(stake)) })}</b> })}
              </p>
              {other ? (
                <button className="btn go" style={{ width: '100%' }} onClick={() => playDuel(other)}>
                  {t('playOpen', { game: GAMES[other.game].name })} <b className="num">{other.stake}</b>
                </button>
              ) : (
                <button className="btn go" id="dFind" style={{ width: '100%' }} onClick={find} disabled={busy}>
                  {t('find')}
                </button>
              )}
            </>
          )}
        </div>
        <div className="duelSide">
        <div className="panelx" id="duelR">
          <h3>{t('yours')}</h3>
          <p style={{ color: 'var(--soft)', margin: '0 0 8px' }}>{t('record', { won: data.won, lost: data.lost })}</p>
          {data.waiting.length > 0 && (
            <>
              <ul className="dh">
                {data.waiting.map((d) => (
                  <li key={d.id}>
                    <i className="w wt" style={{ fontStyle: 'normal' }} aria-label={t('waiting')}>
                      …
                    </i>
                    <span>
                      <b>{GAMES[d.game].name}</b>
                      {t('youScored', { n: fmt(d.myScore ?? 0) })}
                    </span>
                    <b className="num" style={{ color: 'var(--dim)' }}>
                      {fmt(d.stake)}
                    </b>
                  </li>
                ))}
              </ul>
              <p style={{ color: 'var(--dim)', margin: '6px 0 14px', fontSize: 14 }}>{t('waitingNote', { h: ECONOMY.duelExpiryHours })}</p>
            </>
          )}
          {data.history.length ? (
            <ul className="dh">
              {data.history.map((d) => (
                <li key={d.id}>
                  <i className={`w ${d.win ? '' : 'l'}`} style={{ fontStyle: 'normal' }}>
                    {d.win ? t('win') : t('loss')}
                  </i>
                  <span>
                    <b>{GAMES[d.game].name}</b>
                    {t('vsLine', { opp: d.opponent ?? '', mine: fmt(d.myScore ?? 0), theirs: fmt(d.theirScore ?? 0) })}
                  </span>
                  <b className="num" style={{ color: d.win ? 'var(--mint)' : '#d81f5c' }}>
                    {d.amount > 0 ? '+' : ''}
                    {fmt(d.amount)}
                  </b>
                </li>
              ))}
            </ul>
          ) : data.waiting.length ? null : (
            <p style={{ color: 'var(--dim)', margin: '14px 0 0' }}>{t('none')}</p>
          )}
        </div>
        <div className="panelx" id="ghosts">
          <h3>{t('ghosts')}</h3>
          <p className="ghostsSub">{t('ghostsSub', { game: GAMES[game].name })}</p>
          <GhostList list={ghostList} limit={5} onPlay={chase} />
        </div>
        </div>
      </div>
    </section>
  );
}

/** Real recorded runs to chase. A ghost is another player's accepted run, never a generated one. */
function GhostList({ list, limit, onPlay }: { list: GhostEntry[] | null; limit: number; onPlay(g: GhostEntry): void }) {
  const t = useT('duels', duelsEn);
  if (!list) return <p className="ghostsEmpty">{t('loading')}</p>;
  if (!list.length) return <p className="ghostsEmpty">{t('empty')}</p>;
  return (
    <ul className="dh ghostList">
      {list.slice(0, limit).map((g) => (
        <li key={g.code}>
          <FramedAvatar id={g.avatar} frame={g.frame} size={30} />
          <span>
            <b>{g.name}</b> · #{g.place}
            <small>{t('freeXp')}</small>
          </span>
          <b className="num">{fmt(g.score)}</b>
          <button className="sbtn" onClick={() => onPlay(g)} aria-label={t('playFreeAria', { name: g.name, score: fmt(g.score) })}>
            {t('playFree')}
          </button>
        </li>
      ))}
    </ul>
  );
}
