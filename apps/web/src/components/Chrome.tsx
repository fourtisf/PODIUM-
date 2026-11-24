'use client';
// Shared chrome of every page except /play: sticky header, activity ticker, notifications panel.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BRAND, fmt, tokenCa, xUrl } from '@podium/shared';
import type { ActivityItem, NotificationItem } from '@podium/shared';
import { api } from '@/lib/api';
import { onlyBold } from '@/lib/sanitize';
import { useSession } from './Session';
import { FramedAvatar, Mark } from './ui';

const NAV: [href: string, label: string][] = [
  ['/', 'Games'],
  ['/duels', 'Duels'],
  ['/leaderboard', 'Leaderboard'],
  ['/shop', 'Shop'],
  ['/rules', 'Rules'],
];

export function Header() {
  const { me, refresh, patchUser, toast, fail, chain, openWallet } = useSession();
  const pathname = usePathname() || '/';
  const [notesOn, setNotesOn] = useState(false);
  const [notes, setNotes] = useState<NotificationItem[] | null>(null);
  const [unreadShown, setUnreadShown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const readTimer = useRef<ReturnType<typeof setTimeout>>();
  const u = me?.user;
  const unread = unreadShown ?? me?.unread ?? 0;

  useEffect(() => setUnreadShown(null), [me?.unread]);

  const toggleNotes = useCallback(() => {
    setNotesOn((on) => {
      const next = !on;
      if (next && u) {
        api.notifications().then(
          (r) => setNotes(r.items),
          () => setNotes((n) => n ?? []),
        );
        clearTimeout(readTimer.current);
        // Opening the panel marks everything read after a moment, as in the prototype.
        readTimer.current = setTimeout(() => {
          api.notificationsRead().then(
            () => setUnreadShown(0),
            () => undefined,
          );
        }, 1200);
      }
      if (!next) setNotes((n) => n && n.map((x) => ({ ...x, read: true })));
      return next;
    });
  }, [u]);

  useEffect(() => {
    if (!notesOn) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest && !t.closest('#notes') && !t.closest('#bell')) {
        setNotesOn(false);
        setNotes((n) => n && n.map((x) => ({ ...x, read: true })));
      }
    };
    addEventListener('click', close);
    return () => removeEventListener('click', close);
  }, [notesOn]);
  useEffect(() => () => clearTimeout(readTimer.current), []);

  const refill = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.refill();
      patchUser({ balance: r.balance });
      toast(`Refilled. Your balance is ${fmt(r.balance)} tChips.`);
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const isOn = (href: string) => (href === '/' ? pathname === '/' || pathname.startsWith('/c/') : pathname.startsWith(href));

  return (
    <>
      <header className="hd">
        <div className="wrap">
          <Link className="mark" href="/" aria-label={`${BRAND.name} home`}>
            <Mark />
            <span className="brandN">{BRAND.name}</span>
          </Link>
          <nav className="nav" aria-label="Main">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className={isOn(href) ? 'on' : ''} aria-current={isOn(href) ? 'page' : undefined}>
                {label}
              </Link>
            ))}
          </nav>
          <XButton />
          <button className="hbtn" id="bell" aria-label="Notifications" aria-expanded={notesOn} onClick={toggleNotes}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8M8.2 16a2 2 0 0 0 3.6 0" />
            </svg>
            <i>{unread || ''}</i>
          </button>
          <div className="wallet">
            <i className="chip" />
            <b className="num" id="bal">
              {fmt(u?.balance ?? 0)}
            </b>
            <span>tChips</span>
            {__CHAIN__ && chain ? (
              // Chain mode has no refill: the button opens the wallet sheet (deposit, withdraw, test tokens).
              <button onClick={openWallet}>Wallet</button>
            ) : (
              <button onClick={refill} disabled={busy || !me?.canRefill}>
                Refill
              </button>
            )}
          </div>
          <Link className="mechip" href="/profile" aria-label="Profile">
            <FramedAvatar id={u?.avatar ?? 0} frame={u?.frame ?? 'none'} size={30} />
            <span>{u?.name ?? 'Guest'}</span>
            <small>Lv {u?.level ?? 1}</small>
          </Link>
        </div>
      </header>
      <div id="notes" className={notesOn ? 'on' : ''} role="region" aria-label="Notifications">
        <h4>Notifications</h4>
        <ul>
          {(notes ?? []).map((n) => (
            <li key={n.id} className={n.read ? '' : 'new'}>
              <span dangerouslySetInnerHTML={{ __html: onlyBold(n.body) }} />
            </li>
          ))}
        </ul>
        {(!notes || notes.length === 0) && <div className="empty">Nothing yet. Play a ranked run and rivals will start showing up here.</div>}
      </div>
    </>
  );
}

export function Ticker({ initial }: { initial: ActivityItem[] }) {
  const [items, setItems] = useState(initial);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      api.activity().then(
        (r) => setItems(r.items),
        () => undefined,
      );
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!items.length) {
    return (
      <div className="tick">
        <div className="quiet">
          <span>No activity yet. Be the first on the board.</span>
        </div>
      </div>
    );
  }
  // The marquee scrolls by half its width, so the list is laid out twice; a short list is
  // repeated until one half is wide enough to fill the screen.
  const shown = items.slice(0, 12);
  const half: ActivityItem[] = [];
  while (half.length < 12) half.push(...shown);
  const row = (k: string) =>
    half.map((f, i) => (
      <span key={k + i}>
        <b>{f.name}</b> {f.text} <i>{f.game}</i>
      </span>
    ));
  return (
    <div className="tick">
      <div>
        {row('a')}
        {row('b')}
      </div>
    </div>
  );
}

const X_PATH = 'M14.2 10.5L22 1.5h-1.9l-6.8 7.8L8 1.5H1.8l8.2 11.9-8.2 9.4h1.9l7.1-8.2 5.7 8.2h6.2l-8.5-12.3zm-2.5 2.9l-.8-1.2L4.3 2.9h2.8l5.3 7.6.8 1.2 6.9 9.9h-2.8l-5.6-8.2z';

/** The X logo button in the header. Until the profile link is configured it says the account is coming soon. */
function XButton() {
  const { toast } = useSession();
  const href = xUrl();
  const icon = (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'var(--ink)', stroke: 'none', width: 16, height: 16 }}>
      <path d={X_PATH} />
    </svg>
  );
  return href ? (
    <a className="hbtn" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${BRAND.name} on X`}>
      {icon}
    </a>
  ) : (
    <button className="hbtn" aria-label={`${BRAND.name} on X, coming soon`} onClick={() => toast(`Our X account is coming soon.`)}>
      {icon}
    </button>
  );
}

/** Slim bar under the ticker: the token contract address with a copy button, "Coming soon" until it is set. */
export function CaBar() {
  const { toast } = useSession();
  const ca = tokenCa();
  const x = xUrl();
  const copy = () => {
    if (!ca) return;
    const bad = () => toast('Copy failed. Select the address and copy it manually.');
    try {
      navigator.clipboard.writeText(ca).then(() => toast('Contract address copied.'), bad);
    } catch {
      bad();
    }
  };
  return (
    <div className="cabar">
      <div className="wrap">
        <span className="calbl">CA</span>
        {ca ? (
          <code className="caval" title={ca}>
            {ca}
          </code>
        ) : (
          <span className="caval soon">Coming soon</span>
        )}
        <button className="cacopy" onClick={copy} disabled={!ca} aria-label={ca ? 'Copy contract address' : 'Contract address coming soon'}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="7" y="7" width="10" height="10" rx="2.5" />
            <path d="M13 4.5A1.5 1.5 0 0 0 11.5 3h-6A2.5 2.5 0 0 0 3 5.5v6A1.5 1.5 0 0 0 4.5 13" />
          </svg>
          {ca ? 'Copy' : 'Soon'}
        </button>
        {x && (
          <a className="cax" href={x} target="_blank" rel="noopener noreferrer">
            Follow on X
          </a>
        )}
      </div>
    </div>
  );
}

export function Footer() {
  const x = xUrl();
  return (
    <footer>
      <div className="wrap">
        {BRAND.name} beta. All amounts are tChips with no value.
        {x && (
          <>
            {' '}
            <a href={x} target="_blank" rel="noopener noreferrer">
              Follow us on X
            </a>
          </>
        )}
      </div>
    </footer>
  );
}
