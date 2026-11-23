'use client';
// Games (home): daily streak, missions, hero, Cup banner, Featured cards, Classics.
// Markup and copy follow the prototype's render(), renderMeta() and renderV9().
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BRAND, ECONOMY, GAMES, GAME_KEYS, STREAK, STREAK_BOX_INDEX, dayNum, fmt, missionsForDay } from '@podium/shared';
import type { ChallengeResponse, CupResponse, GameCard, GameKey, GamesResponse, MissionState } from '@podium/shared';
import { api } from '@/lib/api';
import { endsCup, endsLong } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useSession } from './Session';
import { Cover } from './ui';

function Top3({ card, myName, style }: { card: GameCard; myName?: string; style?: React.CSSProperties }) {
  return (
    <ol className="top3" style={style}>
      {card.top3.length === 0 && (
        <li className="none">
          <span className="pos">–</span>
          <span className="nm">No scores yet</span>
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
  useEffect(() => setGames(initialGames), [initialGames]);
  useEffect(() => setCup(initialCup), [initialCup]);
  useEffect(() => {
    if (challenge) s.offerChallenge(challenge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);

  const by = Object.fromEntries(games.games.map((g) => [g.key, g])) as Record<GameKey, GameCard>;
  const heroKey = by[games.hero] ? games.hero : games.games[0]!.key;
  const hero = by[heroKey], hg = GAMES[heroKey];
  const ends = endsLong(hero.endsAt, now);
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
      s.toast(`Day ${r.day} streak: +${fmt(r.chips)} tChips${r.box ? ' and a mystery box' : ''}`);
    });
  const claimMission = (id: string) =>
    act('m' + id, async () => {
      const r = await api.claimMission(id);
      s.patchUser({ balance: r.balance, boxes: r.boxes });
      s.toast(`+${fmt(r.chips)} tChips, +${r.xp} XP${r.bonusBox ? ', and a mystery box for clearing all three' : ''}`);
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
          <h3>Daily streak</h3>
          <p>
            {st.claimedToday
              ? `Day ${st.nextDay} claimed. Come back tomorrow to keep it going.`
              : `Claim day ${st.nextDay} for ${st.amount} tChips${st.box || sIdx === STREAK_BOX_INDEX ? ' and a mystery box' : ''}.`}
          </p>
          <div className="pips">
            {STREAK.map((a, i) => (
              <span key={i} className={i < (st.claimedToday ? sIdx + 1 : sIdx) ? 'done' : i === sIdx && !st.claimedToday ? 'next' : ''}>
                {i === STREAK_BOX_INDEX ? 'Box' : a}
              </span>
            ))}
          </div>
          <button className="sbtn" id="stClaim" disabled={st.claimedToday || busy === 'streak'} onClick={claimStreak}>
            {st.claimedToday ? 'Claimed today' : "Claim today's reward"}
          </button>
        </div>
        <div className="panelx">
          <h3>Today&apos;s missions</h3>
          <p>
            Clear all three for a mystery box. {free > 0 ? `You have ${free} free practice ${free > 1 ? 'runs' : 'run'} left.` : ''}
          </p>
          {missions.map((m) => {
            const done = m.progress >= m.target;
            return (
              <div className="mis" key={m.id}>
                <div>
                  <b>{m.title}</b>{' '}
                  <small>
                    {Math.min(m.progress, m.target)}/{m.target}
                  </small>
                  <div className="bar">
                    <u style={{ width: `${Math.min(100, (m.progress / m.target) * 100)}%` }} />
                  </div>
                </div>
                <button className={`sbtn ${done && !m.claimed ? '' : 'lt'}`} disabled={!(done && !m.claimed) || busy === 'm' + m.id} onClick={() => claimMission(m.id)}>
                  {m.claimed ? 'Claimed' : `${m.chips} tChips`}
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
            <span className="tag live">Biggest pool this week</span>
            <span className="tag">{hg.tag}</span>
          </div>
          <h1>{hg.name}</h1>
          <p>{hg.desc}</p>
          <Top3 card={hero} myName={myName} style={{ margin: '22px 0 0' }} />
          <div className="poolbox">
            <small>Prize pool, ends in {ends}</small>
            <div className="num">
              {fmt(hero.pool)}
              <em>tChips</em>
            </div>
            <div className="cta">
              <button className="btn go" onClick={() => s.openSheet(heroKey, hero.pool)}>
                Play now
              </button>
              <Link className="btn alt" href={`/leaderboard?game=${heroKey}`}>
                View leaderboard
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
          <span className="tag">This week&apos;s cup</span>
          <h3>
            {BRAND.name} Cup: {cg.name}
          </h3>
          <p>One game, a bigger pool, and the top five get paid. Entry is {cup.entry} tChips.</p>
          <div className="meta">
            <div>
              <small>Pool</small>
              <b className="num">{fmt(cup.pool)}</b>
            </div>
            <div>
              <small>First place</small>
              <b className="num">{fmt(cup.payouts[0] ?? 0)}</b>
            </div>
            <div>
              <small>Ends in</small>
              <b className="num">{endsCup(cup.period.endAt, now)}</b>
            </div>
            <div>
              <small>Your place</small>
              <b className="num">{cup.me ? '#' + cup.me.place : 'Not entered'}</b>
            </div>
          </div>
        </div>
        <button className="btn" id="cupGo" onClick={() => s.play(cup.game, 'cup')}>
          Enter the cup <b className="num">{cup.entry}</b>
        </button>
      </div>

      <div className="sec">
        <h2>Featured</h2>
        <span className="cnt" id="count">
          {featured.length}
        </span>
        <p>
          Weekly pools, ending <span id="endsA">in {ends}</span>
        </p>
      </div>
      <div className="cards" id="cards">
        {featured.map((k) => {
          const g = GAMES[k], c = by[k];
          return (
            <article className="gc" key={k}>
              <div className="cover">
                <Cover game={k} />
                {g.isNew && <span className="newp">New</span>}
                <div className="pill">
                  <i className="chip" />
                  Pool <b className="num">{fmt(c.pool)}</b>
                </div>
              </div>
              <div className="in">
                <h3>{g.name}</h3>
                <p className="d">{g.desc}</p>
                <Top3 card={c} myName={myName} />
                <div className="cta">
                  <button className="btn go" onClick={() => s.play(k, 'ranked')} aria-label={`Play ${g.name} ranked for ${ECONOMY.rankedEntry} tChips`}>
                    Ranked <b className="num">{ECONOMY.rankedEntry}</b>
                  </button>
                  <button className="btn alt" onClick={() => s.play(k, 'practice')} aria-label={`Practice ${g.name}`}>
                    Practice <b className="num">{ECONOMY.practiceEntry}</b>
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="sec">
        <h2>Classics</h2>
        <p>Quick games with their own pools</p>
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
                <small>
                  Pool {fmt(c.pool)}, best {fmt(c.myBest ?? 0)}
                </small>
                <div className="row">
                  <button className="sbtn" onClick={() => s.play(k, 'ranked')} aria-label={`Play ${GAMES[k].name} ranked for ${ECONOMY.rankedEntry} tChips`}>
                    Ranked {ECONOMY.rankedEntry}
                  </button>
                  <button className="sbtn lt" onClick={() => s.play(k, 'practice')} aria-label={`Practice ${GAMES[k].name}`}>
                    Practice
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
