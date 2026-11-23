// Weekly leaderboard, server-rendered per game. Tabs are real links (?game=<key>).
import type { Metadata } from 'next';
import Link from 'next/link';
import { ECONOMY, FEATURED_ORDER, GAMES, GAME_KEYS, fmt, isGameKey } from '@podium/shared';
import type { BoardResponse, MeResponse } from '@podium/shared';
import { EndsIn } from '@/components/EndsIn';
import { FramedAvatar } from '@/components/ui';
import { emptyBoard } from '@/lib/fallback';
import { serverGet } from '@/lib/server-api';

export const metadata: Metadata = { title: "This week's leaderboard" };

export default async function LeaderboardPage({ searchParams }: { searchParams: { game?: string | string[] } }) {
  const q = Array.isArray(searchParams.game) ? searchParams.game[0] : searchParams.game;
  const tab = isGameKey(q) ? q : FEATURED_ORDER[0]!;
  const [fetched, me] = await Promise.all([serverGet<BoardResponse>(`/leaderboard/${tab}`), serverGet<MeResponse>('/me')]);
  const board = fetched ?? emptyBoard(tab);
  const myId = me?.user.id;
  return (
    <section className="view on" id="v-board">
      <h1>
        This week&apos;s leaderboard
        <span className="tag" title="Boards are in beta while score validation builds up history.">
          Beta
        </span>
      </h1>
      <p className="lede">The top three scores split the pool when the week ends. Only your best score counts.</p>
      <div className="seg" id="tabs">
        {GAME_KEYS.map((k) => (
          <Link key={k} href={`/leaderboard?game=${k}`} scroll={false} className={k === tab ? 'on' : ''} aria-current={k === tab ? 'page' : undefined}>
            {GAMES[k].name}
          </Link>
        ))}
      </div>
      <div className="lb">
        <div className="panelx">
          <small style={{ color: 'var(--dim)' }}>Prize pool</small>
          <b className="num big" id="pPool">
            {fmt(board.pool)}
          </b>
          <div className="kv">
            <span>Paid to the top three</span>
            <b className="num">{fmt(board.pool - board.fee)}</b>
          </div>
          <div className="kv">
            <span>Platform fee {Math.round(ECONOMY.fee * 100)}%</span>
            <b className="num">{fmt(board.fee)}</b>
          </div>
          <div className="kv">
            <span>Ends in</span>
            <b className="num">
              <EndsIn to={board.period.endAt} serverTime={new Date().toISOString()} />
            </b>
          </div>
        </div>
        <div className="panelx">
          <table>
            <thead>
              <tr>
                <th>Place</th>
                <th>Player</th>
                <th className="r">Score</th>
                <th className="r">Prize</th>
              </tr>
            </thead>
            <tbody id="board">
              {board.rows.length === 0 && (
                <tr>
                  <td className="none" colSpan={4}>
                    No scores yet this week.
                  </td>
                </tr>
              )}
              {board.rows.map((r) => (
                <tr key={r.userId} className={r.userId === myId ? 'me' : ''}>
                  <td>
                    <b className="num">{r.place}</b>
                  </td>
                  <td>
                    <span className="who">
                      <FramedAvatar id={r.avatar} frame={r.frame} size={26} />
                      {r.name}
                    </span>
                  </td>
                  <td className="r">
                    <b className="num">{fmt(r.score)}</b>
                  </td>
                  <td className="r">{r.prize > 0 ? <b className="num prize">{fmt(r.prize)}</b> : <span style={{ color: 'var(--dim)' }}>–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
