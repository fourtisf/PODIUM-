// Weekly leaderboard, server-rendered per game. Tabs are real links (?game=<key>).
import type { Metadata } from 'next';
import Link from 'next/link';
import { ECONOMY, FEATURED_ORDER, GAMES, GAME_KEYS, fmt, isGameKey } from '@podium/shared';
import type { BoardResponse, MeResponse } from '@podium/shared';
import { EndsIn } from '@/components/EndsIn';
import { BotAvatar, BotChip, FramedAvatar } from '@/components/ui';
import { botsFor, withBenchmarks } from '@/lib/benchmarks';
import { emptyBoard } from '@/lib/fallback';
import { serverGet } from '@/lib/server-api';
import { serverT } from '@/i18n/server';

export function generateMetadata(): Metadata {
  return { title: serverT('pages')('meta.board') };
}

export default async function LeaderboardPage({ searchParams }: { searchParams: { game?: string | string[] } }) {
  const q = Array.isArray(searchParams.game) ? searchParams.game[0] : searchParams.game;
  const tab = isGameKey(q) ? q : FEATURED_ORDER[0]!;
  const [fetched, me] = await Promise.all([serverGet<BoardResponse>(`/leaderboard/${tab}`), serverGet<MeResponse>('/me')]);
  const board = fetched ?? emptyBoard(tab);
  const myId = me?.user.id;
  const t = serverT('pages');
  const tc = serverT('common');
  // Display only: labelled bot rows fill the board up to ten rows; real rows keep the places the API gave them.
  const rows = withBenchmarks(board.rows, botsFor(tab));
  return (
    <section className="view on" id="v-board">
      <h1>
        {t('lb.title')}
        <span className="tag" title={t('lb.betaTitle')}>
          {t('lb.beta')}
        </span>
      </h1>
      <p className="lede">{t('lb.lede')}</p>
      <div className="seg" id="tabs">
        {GAME_KEYS.map((k) => (
          <Link key={k} href={`/leaderboard?game=${k}`} scroll={false} className={k === tab ? 'on' : ''} aria-current={k === tab ? 'page' : undefined}>
            {GAMES[k].name}
          </Link>
        ))}
      </div>
      <div className="lb">
        <div className="panelx">
          <small style={{ color: 'var(--dim)' }}>{t('lb.pool')}</small>
          <b className="num big" id="pPool">
            {fmt(board.pool)}
          </b>
          <div className="kv">
            <span>{t('lb.paid')}</span>
            <b className="num">{fmt(board.pool - board.fee)}</b>
          </div>
          <div className="kv">
            <span>{t('lb.fee', { n: Math.round(ECONOMY.fee * 100) })}</span>
            <b className="num">{fmt(board.fee)}</b>
          </div>
          <div className="kv">
            <span>{t('lb.ends')}</span>
            <b className="num">
              <EndsIn to={board.period.endAt} serverTime={new Date().toISOString()} />
            </b>
          </div>
        </div>
        <div className="panelx">
          <table>
            <thead>
              <tr>
                <th>{t('lb.place')}</th>
                <th>{t('lb.player')}</th>
                <th className="r">{t('lb.score')}</th>
                <th className="r">{t('lb.prize')}</th>
              </tr>
            </thead>
            <tbody id="board">
              {board.rows.length === 0 && (
                <tr>
                  <td className="none" colSpan={4}>
                    {t('lb.none')}
                  </td>
                </tr>
              )}
              {rows.map((r) =>
                r.bot ? (
                  <tr key={'bot' + r.level} className="bot" title={tc('bot.title', { name: r.name })}>
                    <td>
                      <span aria-hidden="true">—</span>
                    </td>
                    <td>
                      <span className="who">
                        <BotAvatar id={r.avatar} size={26} />
                        {r.name}
                        <BotChip label={tc('bot.chip')} />
                      </span>
                    </td>
                    <td className="r">
                      <span className="num">{fmt(r.score)}</span>
                    </td>
                    <td className="r">
                      <span aria-hidden="true">—</span>
                    </td>
                  </tr>
                ) : (
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
                ),
              )}
            </tbody>
          </table>
          {rows.some((r) => r.bot) && <p className="lbnote">{tc('bot.note')}</p>}
        </div>
      </div>
    </section>
  );
}
