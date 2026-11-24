'use client';
// Operator tools (/admin). Not linked from the site. The API decides who is an operator
// (ADMIN_EMAILS / ADMIN_WALLETS); everyone else gets "Not available" here and 401/403 there.
import { useCallback, useEffect, useState } from 'react';
import { GAMES, fmt } from '@podium/shared';
import type { AdminOverviewResponse, AdminRunRow, AdminUserDetail, AdminUserRow } from '@podium/shared';
import { ApiFailure, api } from '@/lib/api';
import { useSession } from './Session';

type Tab = 'overview' | 'runs' | 'users';
const when = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');

export function AdminView() {
  const s = useSession();
  const [state, setState] = useState<'loading' | 'denied' | 'ok'>('loading');
  const [tab, setTab] = useState<Tab>('overview');
  const [ov, setOv] = useState<AdminOverviewResponse | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOv(await api.adminOverview());
      setState('ok');
    } catch (e) {
      if (e instanceof ApiFailure && (e.status === 401 || e.status === 403)) setState('denied');
      else {
        s.fail(e);
        setState((st) => (st === 'loading' ? 'denied' : st));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void loadOverview();
  }, [loadOverview, s.me?.user.id]);

  if (state === 'loading') {
    return (
      <section className="view on" id="v-admin">
        <h1>Admin</h1>
        <p className="lede">Loading…</p>
      </section>
    );
  }
  if (state === 'denied') {
    return (
      <section className="view on" id="v-admin">
        <h1>Not available</h1>
        <p className="lede">This page is not available.</p>
      </section>
    );
  }
  return (
    <section className="view on admin" id="v-admin">
      <h1>Admin</h1>
      <div className="seg" role="tablist">
        {(
          [
            ['overview', 'Overview'],
            ['runs', `Flagged runs${ov ? ` (${ov.flaggedPending})` : ''}`],
            ['users', 'Users'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && ov && <Overview ov={ov} reload={loadOverview} />}
      {tab === 'runs' && <Runs onChange={loadOverview} />}
      {tab === 'users' && <Users chainOn={!!ov?.chain} />}
    </section>
  );
}

// ---------------------------------------------------------------- overview
function Overview({ ov, reload }: { ov: AdminOverviewResponse; reload(): Promise<void> }) {
  const kv: [string, number][] = [
    ['Users', ov.users],
    ['Signed-in users', ov.signedInUsers],
    ['Runs today', ov.runsToday],
    ['Flagged runs waiting', ov.flaggedPending],
    ['Rejected runs today', ov.rejectedToday],
    ['Open duels', ov.openDuels],
    ['Fees today (tChips)', ov.feesToday],
  ];
  if (ov.chain) kv.push(['Chain ops pending', ov.chain.pendingOps], ['Chain ops failed', ov.chain.failedOps], ['Players on hold', ov.chain.holds]);
  return (
    <div className="about adminGrid">
      <div className="panelx">
        <h3>Today</h3>
        {kv.map(([k, v]) => (
          <div className="kv" key={k}>
            <span>{k}</span>
            <b className="num">{fmt(v)}</b>
          </div>
        ))}
        <button className="ghost" onClick={() => void reload()}>
          Refresh
        </button>
      </div>
      <div className="panelx">
        <h3>Pools this week</h3>
        <div className="adminTable">
          <table>
            <thead>
              <tr>
                <th>Game</th>
                <th className="r">Pool</th>
                <th className="r">Closes</th>
              </tr>
            </thead>
            <tbody>
              {ov.pools.map((p) => (
                <tr key={p.game}>
                  <td>{GAMES[p.game].name}</td>
                  <td className="r">
                    <b className="num">{fmt(p.pool)}</b>
                  </td>
                  <td className="r">{when(p.endsAt)}</td>
                </tr>
              ))}
              <tr>
                <td>Cup: {GAMES[ov.cup.game].name}</td>
                <td className="r">
                  <b className="num">{fmt(ov.cup.pool)}</b>
                </td>
                <td className="r">{when(ov.cup.endsAt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- runs
function pressText(r: AdminRunRow): string {
  if (!r.press) return 'no log';
  return `${r.press.presses} presses, peak ${r.press.peakPerSecond}/s, cv ${r.press.intervalCv}`;
}

function Runs({ onChange }: { onChange(): Promise<void> }) {
  const s = useSession();
  const [status, setStatus] = useState<'flagged' | 'rejected'>('flagged');
  const [runs, setRuns] = useState<AdminRunRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      try {
        const r = await api.adminRuns(status, cursor);
        setRuns((old) => (cursor && old ? [...old, ...r.runs] : r.runs));
        setNext(r.next);
      } catch (e) {
        s.fail(e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status],
  );
  useEffect(() => {
    setRuns(null);
    void load();
  }, [load]);

  const act = async (r: AdminRunRow, what: 'approve' | 'reject') => {
    if (busy) return;
    setBusy(r.id);
    try {
      const note = notes[r.id] ?? '';
      await (what === 'approve' ? api.adminApprove(r.id, note) : api.adminReject(r.id, note));
      s.toast(what === 'approve' ? `Approved. ${r.user.name}'s run is settled.` : `Rejected ${r.user.name}'s run.`);
      setRuns((list) => (list ? list.filter((x) => x.id !== r.id) : list));
      void onChange();
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panelx">
      <div className="chips">
        {(['flagged', 'rejected'] as const).map((k) => (
          <button key={k} className={status === k ? 'on' : ''} aria-pressed={status === k} onClick={() => setStatus(k)}>
            {k === 'flagged' ? 'Waiting for review' : 'Rejected'}
          </button>
        ))}
      </div>
      {!runs ? (
        <p className="ghostsEmpty">Loading…</p>
      ) : !runs.length ? (
        <p className="ghostsEmpty">{status === 'flagged' ? 'No flagged runs. Nothing to review.' : 'No rejected runs.'}</p>
      ) : (
        <div className="adminTable runsTable">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Player</th>
                <th>Run</th>
                <th className="r">Score</th>
                <th>Why</th>
                {status === 'flagged' && <th>Decision</th>}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{when(r.createdAt)}</td>
                  <td>{r.user.name}</td>
                  <td>
                    {GAMES[r.game].name}
                    <small className="sub">
                      {r.mode}, {Math.round((r.frames ?? 0) / 60)} s
                    </small>
                  </td>
                  <td className="r">
                    <b className="num">{r.score === null ? '–' : fmt(r.score)}</b>
                    <small className="sub">client {r.clientScore === null ? '–' : fmt(r.clientScore)}</small>
                  </td>
                  <td>
                    {r.reason ?? ''}
                    <small className="sub">{pressText(r)}</small>
                  </td>
                  {status === 'flagged' && (
                    <td className="decide">
                      <input
                        className="note-in"
                        placeholder="Note"
                        aria-label={`Note for ${r.user.name}'s run`}
                        maxLength={500}
                        value={notes[r.id] ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      />
                      <button className="sbtn" disabled={busy === r.id} onClick={() => void act(r, 'approve')}>
                        Approve
                      </button>
                      <button className="sbtn lt" disabled={busy === r.id} onClick={() => void act(r, 'reject')}>
                        Reject
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <button className="ghost" onClick={() => void load(next)}>
          Load more
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- users
function Users({ chainOn }: { chainOn: boolean }) {
  const s = useSession();
  const [q, setQ] = useState('');
  const [list, setList] = useState<AdminUserRow[] | null>(null);
  const [sel, setSel] = useState<AdminUserDetail | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const search = async () => {
    try {
      setList((await api.adminUsers(q.trim())).users);
    } catch (e) {
      s.fail(e);
    }
  };
  useEffect(() => {
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const open = async (id: string) => {
    try {
      setSel(await api.adminUser(id));
      setNote('');
    } catch (e) {
      s.fail(e);
    }
  };
  const act = async (f: () => Promise<unknown>, done: string) => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      await f();
      s.toast(done);
      await open(sel.id);
      void search();
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="about adminGrid">
      <div className="panelx">
        <h3>Find a player</h3>
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input placeholder="Name, email, wallet or id" aria-label="Search players" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="sbtn">Search</button>
        </form>
        {!list ? (
          <p className="ghostsEmpty">Loading…</p>
        ) : !list.length ? (
          <p className="ghostsEmpty">No players match.</p>
        ) : (
          <ul className="dh">
            {list.map((u) => (
              <li key={u.id}>
                <span>
                  <b>{u.name}</b>
                  {u.guest ? ' · guest' : ''}
                  {u.flagged ? ' · flagged' : ''}
                  {u.chainHold ? ' · hold' : ''}
                  <small className="sub">{u.email ?? u.wallet ?? u.id}</small>
                </span>
                <b className="num">{fmt(u.balance)}</b>
                <button className={`sbtn ${sel?.id === u.id ? '' : 'lt'}`} onClick={() => void open(u.id)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panelx">
        {!sel ? (
          <p className="ghostsEmpty">Open a player to see their profile, ledger and runs.</p>
        ) : (
          <>
            <h3>{sel.name}</h3>
            {(
              [
                ['Id', sel.id],
                ['Email', sel.email ?? '–'],
                ['Wallet', sel.wallet ?? '–'],
                ['Google linked', sel.googleLinked ? 'yes' : 'no'],
                ['Account', `${sel.guest ? 'guest' : 'signed in'}${sel.adult ? ', 18+' : ''}`],
                ['Joined', when(sel.createdAt)],
                ['Balance', `${fmt(sel.balance)} tChips`],
                ['Level / XP', `${sel.level} / ${fmt(sel.xp)}`],
                ['Validated ranked runs', String(sel.validatedRanked)],
                ['Plays, spent, won', `${fmt(sel.stats.plays)}, ${fmt(sel.stats.spent)}, ${fmt(sel.stats.won)}`],
                ['Duels won / lost', `${sel.stats.duelsWon} / ${sel.stats.duelsLost}`],
                ['Last IP', sel.lastIp ?? '–'],
                ['Flagged', sel.flagged ? 'yes, rewards held' : 'no'],
                ...(chainOn ? [['Chain hold', sel.chainHold ? 'yes' : 'no'] as [string, string]] : []),
              ] as [string, string][]
            ).map(([k, v]) => (
              <div className="kv" key={k}>
                <span>{k}</span>
                <b className="kvv">{v}</b>
              </div>
            ))}
            <div className="field" style={{ marginBottom: 8 }}>
              <input placeholder="Note for the audit log" aria-label="Note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="adminActs">
              <button
                className={`sbtn ${sel.flagged ? 'lt' : ''}`}
                disabled={busy}
                onClick={() => void act(() => api.adminFlag(sel.id, !sel.flagged, note), sel.flagged ? 'Flag cleared.' : 'Account flagged: rewards are held.')}
              >
                {sel.flagged ? 'Unflag' : 'Flag'}
              </button>
              {chainOn && (
                <button className="sbtn lt" disabled={busy || !sel.chainHold} onClick={() => void act(() => api.adminClearHold(sel.id, note), 'Hold cleared.')}>
                  Clear hold
                </button>
              )}
            </div>
            <div className="lbl" style={{ marginTop: 22 }}>
              Last runs
            </div>
            <div className="adminTable">
              <table>
                <tbody>
                  {sel.runs.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap">{when(r.createdAt)}</td>
                      <td>
                        {GAMES[r.game].name}
                        <small className="sub">
                          {r.mode}, {r.status}
                          {r.reason ? `: ${r.reason}` : ''}
                        </small>
                      </td>
                      <td className="r">
                        <b className="num">{r.score === null ? '–' : fmt(r.score)}</b>
                      </td>
                    </tr>
                  ))}
                  {!sel.runs.length && (
                    <tr>
                      <td className="none" colSpan={3}>
                        No runs.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="lbl" style={{ marginTop: 22 }}>
              Last ledger rows
            </div>
            <div className="adminTable">
              <table>
                <tbody>
                  {sel.ledger.map((l) => (
                    <tr key={l.id}>
                      <td className="nowrap">{when(l.createdAt)}</td>
                      <td>{l.reason}</td>
                      <td className="r">
                        <b className="num" style={{ color: l.amount > 0 ? 'var(--mint)' : undefined }}>
                          {l.amount > 0 ? '+' : ''}
                          {fmt(l.amount)}
                        </b>
                      </td>
                    </tr>
                  ))}
                  {!sel.ledger.length && (
                    <tr>
                      <td className="none" colSpan={3}>
                        No ledger rows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {sel.actions.length > 0 && (
              <>
                <div className="lbl" style={{ marginTop: 22 }}>
                  Admin actions
                </div>
                <ul className="dh">
                  {sel.actions.map((a) => (
                    <li key={a.id}>
                      <span>
                        <b>{a.action}</b> by {a.admin}
                        {a.note ? `: ${a.note}` : ''}
                        <small className="sub">{when(a.createdAt)}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
