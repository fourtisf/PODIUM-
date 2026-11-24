'use client';
// Shared chrome of every page except /play: sticky header, activity ticker, notifications panel.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BRAND, fmt, tokenCa, xUrl } from '@podium/shared';
import type { ActivityItem, NotificationItem } from '@podium/shared';
import { api } from '@/lib/api';
import { onlyBold } from '@/lib/sanitize';
import { dedupeActivity, tickerScrolls } from '@/lib/ticker';
import { useT } from '@/i18n/client';
import { tickerText } from '@/i18n/content';
import { commonEn } from '@/i18n/dict/common.en';
import { LangSwitch } from './LangSwitch';
import WalletPicker from './WalletPicker';
import { useWalletActions } from './useWalletActions';
import { useSession } from './Session';
import { FramedAvatar, Mark } from './ui';

const NAV: [href: string, label: keyof typeof commonEn][] = [
  ['/', 'nav.games'],
  ['/duels', 'nav.duels'],
  ['/leaderboard', 'nav.board'],
  ['/shop', 'nav.shop'],
  ['/rules', 'nav.rules'],
];

export function Header() {
  const { me, refresh, patchUser, toast, fail, chain, openWallet } = useSession();
  const t = useT('common', commonEn);
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
      toast(t('hd.refilled', { n: fmt(r.balance) }));
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
          <Link className="mark" href="/" aria-label={t('hd.home', { brand: BRAND.name })}>
            <Mark />
            <span className="brandN">{BRAND.name}</span>
          </Link>
          <nav className="nav" aria-label={t('hd.nav')}>
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className={isOn(href) ? 'on' : ''} aria-current={isOn(href) ? 'page' : undefined}>
                {t(label)}
              </Link>
            ))}
          </nav>
          <XButton />
          <button className="hbtn" id="bell" aria-label={t('hd.bell')} aria-expanded={notesOn} onClick={toggleNotes}>
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
              <button onClick={openWallet}>{t('hd.wallet')}</button>
            ) : (
              <button onClick={refill} disabled={busy || !me?.canRefill}>
                {t('hd.refill')}
              </button>
            )}
          </div>
          <PlayerMenu />
        </div>
      </header>
      <div id="notes" className={notesOn ? 'on' : ''} role="region" aria-label={t('notes.title')}>
        <h4>{t('notes.title')}</h4>
        <ul>
          {(notes ?? []).map((n) => (
            <li key={n.id} className={n.read ? '' : 'new'}>
              <span dangerouslySetInnerHTML={{ __html: onlyBold(n.body) }} />
            </li>
          ))}
        </ul>
        {(!notes || notes.length === 0) && <div className="empty">{t('notes.empty')}</div>}
      </div>
    </>
  );
}

export function Ticker({ initial }: { initial: ActivityItem[] }) {
  const t = useT('common', commonEn);
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
          <span>{t('tick.quiet')}</span>
        </div>
      </div>
    );
  }
  return <TickerRow items={items} />;
}

function TickerRow({ items }: { items: ActivityItem[] }) {
  const t = useT('common', commonEn);
  const shown = dedupeActivity(items);
  const wrap = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  // Scroll only when one copy of the events is at least as wide as the bar; then the doubled track
  // shows every event exactly twice. Otherwise (and on the server) the events are listed once, still.
  const [scroll, setScroll] = useState(false);
  const key = shown.map((f) => f.name + '\u0001' + f.text + '\u0001' + f.game).join('\u0002');
  useEffect(() => {
    const measure = () => {
      const w = wrap.current?.clientWidth ?? 0;
      const el = track.current;
      // Width of one copy of the events: the whole track when static, half of it when doubled.
      const one = el ? el.scrollWidth / Number(el.dataset.copies || 1) : 0;
      setScroll(tickerScrolls(shown.length, one, w));
    };
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, shown.length]);
  const row = (k: string) =>
    shown.map((f, i) => (
      <span key={k + i}>
        <b>{f.name}</b> {tickerText(f.text, t)} <i>{f.game}</i>
      </span>
    ));
  if (!scroll) {
    return (
      <div className="tick" ref={wrap}>
        <div className="static" ref={track} data-copies="1">
          {row('a')}
        </div>
      </div>
    );
  }
  return (
    <div className="tick" ref={wrap}>
      <div ref={track} data-copies="2">
        {row('a')}
        {row('b')}
      </div>
    </div>
  );
}

/** The player chip in the header: opens a small menu with profile, wallet and sign-in/out. */
function PlayerMenu() {
  const s = useSession();
  const t = useT('common', commonEn);
  const u = s.me?.user;
  const { busy, link, disconnect, chainOn } = useWalletActions();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const signedIn = !!u && !u.guest;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (el?.closest && !el.closest('#memenu') && !el.closest('#mechip')) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // Listen from the next tick: the click that opened the menu must not close it again
    // (React may re-render the avatar under the pointer, detaching the click target).
    const id = setTimeout(() => addEventListener('click', close));
    addEventListener('keydown', esc);
    return () => {
      clearTimeout(id);
      removeEventListener('click', close);
      removeEventListener('keydown', esc);
    };
  }, [open]);
  const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
  return (
    <div className="mewrap">
      <button className="mechip" id="mechip" aria-label={t('hd.profile')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <FramedAvatar id={u?.avatar ?? 0} frame={u?.frame ?? 'none'} size={30} />
        <span>{u?.name ?? t('hd.guest')}</span>
        <small>{t('hd.lv', { n: u?.level ?? 1 })}</small>
      </button>
      {open && (
        <div id="memenu" role="menu" aria-label={t('hd.profile')}>
          <div className="mehead">
            <FramedAvatar id={u?.avatar ?? 0} frame={u?.frame ?? 'none'} size={40} />
            <div>
              <b>{u?.name ?? t('hd.guest')}</b>
              <small>{u?.wallet ? short(u.wallet) : t('hd.lv', { n: u?.level ?? 1 })}</small>
            </div>
          </div>
          <Link role="menuitem" href="/profile" onClick={() => setOpen(false)}>
            {t('hd.profile')}
          </Link>
          {signedIn && u?.wallet && !chainOn && (
            <button role="menuitem" disabled={busy} onClick={() => void disconnect().then(() => setOpen(false))}>
              {t('wallet.disconnect')}
            </button>
          )}
          {signedIn && !u?.wallet && (
            <button role="menuitem" disabled={busy} onClick={() => setPicking(true)}>
              {t('wallet.connect')}
            </button>
          )}
          {signedIn ? (
            <button role="menuitem" className="danger" disabled={busy} onClick={() => void s.signOut().then(() => setOpen(false))}>
              {t('menu.signOut')}
            </button>
          ) : (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                s.openSignIn();
              }}
            >
              {t('menu.signIn')}
            </button>
          )}
        </div>
      )}
      {picking && (
        <WalletPicker
          onClose={() => setPicking(false)}
          onPick={() => {
            setPicking(false);
            setOpen(false);
            void link();
          }}
        />
      )}
    </div>
  );
}

const X_PATH = 'M14.2 10.5L22 1.5h-1.9l-6.8 7.8L8 1.5H1.8l8.2 11.9-8.2 9.4h1.9l7.1-8.2 5.7 8.2h6.2l-8.5-12.3zm-2.5 2.9l-.8-1.2L4.3 2.9h2.8l5.3 7.6.8 1.2 6.9 9.9h-2.8l-5.6-8.2z';

/** The X logo button in the header. Until the profile link is configured it says the account is coming soon. */
function XButton() {
  const { toast } = useSession();
  const t = useT('common', commonEn);
  const href = xUrl();
  const icon = (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'var(--ink)', stroke: 'none', width: 16, height: 16 }}>
      <path d={X_PATH} />
    </svg>
  );
  return href ? (
    <a className="hbtn" href={href} target="_blank" rel="noopener noreferrer" aria-label={t('x.on', { brand: BRAND.name })}>
      {icon}
    </a>
  ) : (
    <button className="hbtn" aria-label={t('x.soonAria', { brand: BRAND.name })} onClick={() => toast(t('x.soon'))}>
      {icon}
    </button>
  );
}

/** Slim bar under the ticker: the token contract address with a copy button, "Coming soon" until it is set. */
export function CaBar() {
  const { toast } = useSession();
  const t = useT('common', commonEn);
  const ca = tokenCa();
  const x = xUrl();
  const copy = () => {
    if (!ca) return;
    const bad = () => toast(t('ca.copyFail'));
    try {
      navigator.clipboard.writeText(ca).then(() => toast(t('ca.copied')), bad);
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
          <span className="caval soon">{t('ca.soon')}</span>
        )}
        <button className="cacopy" onClick={copy} disabled={!ca} aria-label={ca ? t('ca.copyAria') : t('ca.soonAria')}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="7" y="7" width="10" height="10" rx="2.5" />
            <path d="M13 4.5A1.5 1.5 0 0 0 11.5 3h-6A2.5 2.5 0 0 0 3 5.5v6A1.5 1.5 0 0 0 4.5 13" />
          </svg>
          {ca ? t('ca.copy') : t('ca.soonBtn')}
        </button>
        {x && (
          <a className="cax" href={x} target="_blank" rel="noopener noreferrer">
            {t('ca.follow')}
          </a>
        )}
      </div>
    </div>
  );
}

export function Footer() {
  const t = useT('common', commonEn);
  const x = xUrl();
  return (
    <footer>
      <div className="wrap">
        {t.rich('foot.line', { brand: BRAND.name, terms: <Link href="/terms">{t('foot.terms')}</Link>, privacy: <Link href="/privacy">{t('foot.privacy')}</Link> })}
        {x && (
          <>
            {' '}
            <a href={x} target="_blank" rel="noopener noreferrer">
              {t('foot.followX')}
            </a>
          </>
        )}
        <LangSwitch />
      </div>
    </footer>
  );
}
