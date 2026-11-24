'use client';
// Games (home): daily streak, missions, hero, Cup banner, Featured cards, Classics.
// Markup and copy follow the prototype's render(), renderMeta() and renderV9().
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BRAND, ECONOMY, GAMES, GAME_KEYS, STREAK, STREAK_BOX_INDEX, dayNum, fmt, missionsForDay } from '@podium/shared';
import type { ChallengeResponse, CupResponse, GameCard, GameKey, GamesResponse, MissionState } from '@podium/shared';
import { api } from '@/lib/api';
import { useNow } from '@/lib/hooks';
import { useContent, useT } from '@/i18n/client';
import { endsText } from '@/i18n/content';
import { commonEn } from '@/i18n/dict/common.en';
import { homeEn } from '@/i18n/dict/home.en';
import { useSession } from './Session';
import { Cover } from './ui';

function Top3({ card, myName, style }: { card: GameCard; myName?: string; style?: React.CSSProperties }) {
  const t = useT('home', homeEn);
  return (
    <ol className="top3" style={style}>
      {card.top3.length === 0 && (
        <li className="none">
          <span className="pos">–</span>
          <span className="nm">{t('top3.none')}</span>
        </li>
      )}
      {card.top3.map((r, i) => (
        <li key={i}>
          <span className="pos">{i + 1}</span>
          <span className={`nm ${myName && r.name === myName ? 'me' : ''}`}>{r.name}</span>
          <b className="num">{fmt(r.score)}</b>
        </li>
      ))}
    </ol>
  );
}

export function HomeView({ games: initialGames, cup: initialCup, challenge }: { games: GamesResponse; cup: CupResponse; challenge: ChallengeResponse | null }) {
  const s = useSession();
  const { me } = s;
  const [games, setGames] = useState(initialGames);
  const [cup, setCup] = useState(initialCup);
  const [busy, setBusy] = useState('');
  const now = useNow(initialGames.serverTime);
  const t = useT('home', homeEn);
  const tc = useT('common', commonEn);
  const content = useContent();
  useEffect(() => setGames(initialGames), [initialGames]);
  useEffect(() => setCup(initialCup), [initialCup]);
  useEffect(() => {
    if (challenge) s.offerChallenge(challenge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);

  const by = Object.fromEntries(games.games.map((g) => [g.key, g])) as Record<GameKey, GameCard>;
  const heroKey = by[games.hero] ? games.hero : games.games[0]!.key;
  const hero = by[heroKey], hg = GAMES[heroKey], hgc = content.game(heroKey);
  const ends = endsText(tc, 'long', hero.endsAt, now);
  const featured = GAME_KEYS.filter((k) => k !== heroKey && GAMES[k].featured && by[k]).sort((a, b) => Number(GAMES[b].isNew) - Number(GAMES[a].isNew));
  const classics = GAME_KEYS.filter((k) => !GAMES[k].featured && by[k]);
  const myName = me?.user.name;

  // ---- daily streak and missions (server state; sensible defaults before a session exists)
  const st = me?.streak ?? { claimedToday: false, nextDay: 1, amount: STREAK[0], box: false };
  const sIdx = (((st.nextDay - 1) % STREAK.length) + STREAK.length) % STREAK.length;
  const missions: MissionState[] = me?.missions ?? missionsForDay(dayNum(Date.parse(games.serverTime))).map((m) => ({ ...m, progress: 0, claimed: false }));
  const free = me ? me.user.freePractice : ECONOMY.freePracticeRuns;

  const act = async (key: string, f: () => Promise<void>) => {
    if (busy || !s.needAccount()) return;
    setBusy(key);
    try {
      await f();
      await s.refresh();
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy('');
    }
  };
  const claimStreak = () =>
    act('streak', async () => {
      const r = await api.claimStreak();
      s.patchUser({ balance: r.balance, boxes: r.boxes });
      s.toast(t(r.box ? 'streak.toastBox' : 'streak.toast', { day: r.day, chips: fmt(r.chips) }));
    });
  const claimMission = (id: string) =>
    act('m' + id, async () => {
      const r = await api.claimMission(id);
      s.patchUser({ balance: r.balance, boxes: r.boxes });
      s.toast(t(r.bonusBox ? 'mission.toastBox' : 'mission.toast', { chips: fmt(r.chips), xp: r.xp }));
    });

  const cg = GAMES[cup.game];
  const reloadSoon = () => {
    api.games().then(setGames, () => undefined);
    api.cup().then(setCup, () => undefined);
  };
  // A tab left open keeps its pools current.
  useEffect(() => {
    const t = setInterval(() => !document.hidden && reloadSoon(), 90_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="view on" id="v-games">
      <div className="today" id="today">
        <div className="panelx">
          <h3>{t('streak.title')}</h3>
          <p>
            {st.claimedToday
              ? t('streak.claimed', { day: st.nextDay })
              : t(st.box || sIdx === STREAK_BOX_INDEX ? 'streak.claimBox' : 'streak.claim', { day: st.nextDay, n: st.amount })}
          </p>
          <div className="pips">
            {STREAK.map((a, i) => (
              <span key={i} className={i < (st.claimedToday ? sIdx + 1 : sIdx) ? 'done' : i === sIdx && !st.claimedToday ? 'next' : ''}>
                {i === STREAK_BOX_INDEX ? t('streak.box') : a}
              </span>
            ))}
          </div>
          <button className="sbtn" id="stClaim" disabled={st.claimedToday || busy === 'streak'} onClick={claimStreak}>
            {st.claimedToday ? t('streak.claimedBtn') : t('streak.claimBtn')}
          </button>
        </div>
        <div className="panelx">
          <h3>{t('missions.title')}</h3>
          <p>
            {t('missions.lede')}
            {free > 0 ? t(free > 1 ? 'missions.freeMany' : 'missions.freeOne', { n: free }) : ''}
          </p>
          {missions.map((m) => {
            const done = m.progress >= m.target;
            return (
              <div className="mis" key={m.id}>
                <div>
                  <b>{content.mission(m.id, m.title)}</b>{' '}
                  <small>
                    {Math.min(m.progress, m.target)}/{m.target}
                  </small>
                  <div className="bar">
                    <u style={{ width: `${Math.min(100, (m.progress / m.target) * 100)}%` }} />
                  </div>
                </div>
                <button className={`sbtn ${done && !m.claimed ? '' : 'lt'}`} disabled={!(done && !m.claimed) || busy === 'm' + m.id} onClick={() => claimMission(m.id)}>
                  {m.claimed ? t('missions.claimed') : `${m.chips} tChips`}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="hero" id="hero">
        <div className="cover">
          <Cover game={heroKey} eager />
        </div>
        <div className="side">
          <div className="tagrow">
            <span className="tag live">{t('hero.tag')}</span>
            <span className="tag">{hgc.tag}</span>
          </div>
          <h1>{hg.name}</h1>
          <p>{hgc.desc}</p>
          <Top3 card={hero} myName={myName} style={{ margin: '22px 0 0' }} />
          <div className="poolbox">
            <small>{t('hero.pool', { ends })}</small>
            <div className="num">
              {fmt(hero.pool)}
              <em>tChips</em>
            </div>
            <div className="cta">
              <button className="btn go" onClick={() => s.openSheet(heroKey, hero.pool)}>
                {t('hero.play')}
              </button>
              <Link className="btn alt" href={`/leaderboard?game=${heroKey}`}>
                {t('hero.board')}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="cup" id="cupB">
        <div className="cover">
          <Cover game={cup.game} />
        </div>
        <div>
          <span className="tag">{t('cup.tag')}</span>
          <h3>{t('cup.title', { brand: BRAND.name, game: cg.name })}</h3>
          <p>{t('cup.lede', { n: cup.entry })}</p>
          <div className="meta">
            <div>
              <small>{t('cup.pool')}</small>
              <b className="num">{fmt(cup.pool)}</b>
            </div>
            <div>
              <small>{t('cup.first')}</small>
              <b className="num">{fmt(cup.payouts[0] ?? 0)}</b>
            </div>
            <div>
              <small>{t('cup.ends')}</small>
              <b className="num">{endsText(tc, 'cup', cup.period.endAt, now)}</b>
            </div>
            <div>
              <small>{t('cup.place')}</small>
              <b className="num">{cup.me ? '#' + cup.me.place : t('cup.notEntered')}</b>
            </div>
          </div>
        </div>
        <button className="btn" id="cupGo" onClick={() => s.play(cup.game, 'cup')}>
          {t('cup.enter')} <b className="num">{cup.entry}</b>
        </button>
      </div>

      <div className="sec">
        <h2>{t('featured.title')}</h2>
        <span className="cnt" id="count">
          {featured.length}
        </span>
        <p>
          {t('featured.lede')}
          <span id="endsA">{t('featured.in', { ends })}</span>
        </p>
      </div>
      <div className="cards" id="cards">
        {featured.map((k) => {
          const g = GAMES[k], c = by[k], gc = content.game(k);
          return (
            <article className="gc" key={k}>
              <div className="cover">
                <Cover game={k} />
                {g.isNew && <span className="newp">{t('card.new')}</span>}
                <div className="pill">
                  <i className="chip" />
                  {t('card.pool')} <b className="num">{fmt(c.pool)}</b>
                </div>
              </div>
              <div className="in">
                <h3>{g.name}</h3>
                <p className="d">{gc.desc}</p>
                <Top3 card={c} myName={myName} />
                <div className="cta">
                  <button className="btn go" onClick={() => s.play(k, 'ranked')} aria-label={t('card.rankedAria', { game: g.name, n: ECONOMY.rankedEntry })}>
                    {t('card.ranked')} <b className="num">{ECONOMY.rankedEntry}</b>
                  </button>
                  <button className="btn alt" onClick={() => s.play(k, 'practice')} aria-label={t('card.practiceAria', { game: g.name })}>
                    {t('card.practice')} <b className="num">{__CHAIN__ && s.chain ? t('card.free') : ECONOMY.practiceEntry}</b>
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="sec">
        <h2>{t('classics.title')}</h2>
        <p>{t('classics.lede')}</p>
      </div>
      <div className="mini" id="classics">
        {classics.map((k) => {
          const c = by[k];
          return (
            <div className="mc" key={k}>
              <div className="cover">
                <Cover game={k} />
              </div>
              <div>
                <b>{GAMES[k].name}</b>
                <small>{t('classics.meta', { pool: fmt(c.pool), best: fmt(c.myBest ?? 0) })}</small>
                <div className="row">
                  <button className="sbtn" onClick={() => s.play(k, 'ranked')} aria-label={t('card.rankedAria', { game: GAMES[k].name, n: ECONOMY.rankedEntry })}>
                    {t('classics.ranked', { n: ECONOMY.rankedEntry })}
                  </button>
                  <button className="sbtn lt" onClick={() => s.play(k, 'practice')} aria-label={t('card.practiceAria', { game: GAMES[k].name })}>
                    {t('card.practice')}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
