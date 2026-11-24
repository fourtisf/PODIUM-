'use client';
// Profile: level ring, stats, name, avatar and frame pickers, mystery boxes, Season track, invite link.
import { useEffect, useState } from 'react';
import { FRAMES, GAMES, GAME_KEYS, REFERRAL, SEASON, SEASON_NUMBER, cleanName, fmt, isFrameKey, levelCeil, levelFloor, validateName } from '@podium/shared';
import type { BoxPrize, GameKey, GamesResponse, SeasonTierState } from '@podium/shared';
import { api } from '@/lib/api';
import { beep } from '@/lib/audio';
import { useContent, useT } from '@/i18n/client';
import type { Content } from '@/i18n/content';
import type { Translator } from '@/i18n/core';
import { commonEn } from '@/i18n/dict/common.en';
import { profileEn } from '@/i18n/dict/profile.en';
import { LangSwitch } from './LangSwitch';
import { ID_ENABLED } from '@/i18n/core';
import { WalletPanel } from './WalletPanel';
import { useSession } from './Session';
import { Avatar, BoxSvg, FrameSwatch } from './ui';

const kv = (a: string, b: string) => (
  <div className="kv" key={a}>
    <span>{a}</span>
    <b className="num">{b}</b>
  </div>
);

export function ProfileView({ games }: { games: GamesResponse | null }) {
  const s = useSession();
  const { me } = s;
  const u = me?.user;
  const t = useT('profile', profileEn);
  const tc = useT('common', commonEn);
  const content = useContent();
  const [name, setName] = useState(u?.name ?? '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [origin, setOrigin] = useState('');
  const [bests, setBests] = useState<Partial<Record<GameKey, number>>>(() => Object.fromEntries((games?.games ?? []).map((g) => [g.key, g.myBest ?? 0])));
  useEffect(() => setOrigin(location.origin), []);
  useEffect(() => {
    if (!editing) setName(u?.name ?? '');
  }, [u?.name, editing]);
  useEffect(() => {
    if (!u) return;
    api.games().then(
      (r) => setBests(Object.fromEntries(r.games.map((g) => [g.key, g.myBest ?? 0]))),
      () => undefined,
    );
  }, [u?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const xp = u?.xp ?? 0, lv = u?.level ?? 1, base = levelFloor(lv), next = levelCeil(lv);
  const boxes = u?.boxes ?? 0;
  const net = (u?.stats.won ?? 0) - (u?.stats.spent ?? 0);

  const run = async (key: string, f: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await f();
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy('');
    }
  };
  const saveName = () =>
    run('name', async () => {
      const v = cleanName(name);
      const bad = validateName(v);
      if (bad) {
        s.toast(content.nameError(bad));
        return;
      }
      await api.patchMe({ name: v });
      setEditing(false);
      await s.refresh();
      s.toast(t('nameSaved'));
    });
  const equip = (p: { avatar?: number; frame?: string }) =>
    run('equip', async () => {
      s.patchUser(p);
      try {
        await api.patchMe(p);
      } finally {
        await s.refresh();
      }
    });
  const openBox = () => {
    if (!s.needAccount()) return;
    void run('box', async () => {
      const r = await api.openBox();
      s.patchUser({ boxes: r.boxes, balance: r.balance, xp: r.xp });
      s.reveal(prizeView(r.prize, t, content));
      beep(660, 0.1, 'sine', 0.05);
      await s.refresh();
    });
  };
  const claimTier = (tier: SeasonTierState) => {
    if (!s.needAccount()) return;
    void run('tier' + tier.tier, async () => {
      const r = await api.claimSeason(tier.tier);
      s.patchUser({ balance: r.balance, boxes: r.boxes });
      s.toast(t('season.toast', { what: r.fallback ? t('season.fallback', { n: fmt(r.chips) }) : r.reward.kind === 'chips' ? t('chips', { n: fmt(r.chips) }) : content.tierName(r.reward) }));
      await s.refresh();
    });
  };
  const copy = (text: string, ok: string) => {
    const bad = () => s.toast(tc('copy.linkFail'));
    try {
      navigator.clipboard.writeText(text).then(() => s.toast(ok), bad);
    } catch {
      bad();
    }
  };

  const season: SeasonTierState[] = me?.season ?? SEASON.map((t, i) => ({ tier: i, xp: t.xp, reward: t.reward, claimed: false, ready: false }));
  const ownedAv = u?.items.avatars ?? [];
  const ownedFr = u?.items.frames ?? ['none'];
  const link = `${origin}/?ref=${u?.refCode ?? ''}`;

  return (
    <section className="view on" id="v-profile">
      <h1>{t('title')}</h1>
      <div className="prof">
        <div className="panelx">
          <div className="lvl">
            <div className="ring" id="ring" style={{ ['--p' as string]: `${next > base ? ((xp - base) / (next - base)) * 100 : 0}%` }}>
              <span id="lv">{lv}</span>
            </div>
            <div>
              <h2 id="lvT">{t('level', { n: lv })}</h2>
              <div style={{ color: 'var(--soft)' }} id="xpT">
                {t('xpLine', { xp: fmt(xp), left: fmt(Math.max(0, next - xp)), next: lv + 1 })}
              </div>
              <div style={{ color: 'var(--dim)', fontSize: 14, marginTop: 4 }} id="boxT">
                {boxes ? t(boxes > 1 ? 'boxesKeptMany' : 'boxesKeptOne', { n: boxes }) : t('boxesNone')}
              </div>
            </div>
          </div>
        </div>
        <div className="panelx">
          <div className="statg" id="stats">
            {kv(t('stat.plays'), fmt(u?.stats.plays ?? 0))}
            {kv(t('stat.spent'), fmt(u?.stats.spent ?? 0))}
            {kv(t('stat.won'), fmt(u?.stats.won ?? 0))}
            {kv(t('stat.net'), (net > 0 ? '+' : '') + fmt(net))}
            {GAME_KEYS.map((k) => kv(t('stat.best', { game: GAMES[k].name }), fmt(bests[k] ?? 0)))}
          </div>
          <p className="acct">
            {!u || u.guest ? (
              <>
                <button className="ghost" onClick={s.openSignIn}>
                  {t('signIn')}
                </button>
                <span>{t('signInWhy')}</span>
              </>
            ) : (
              <button className="ghost" onClick={() => void s.signOut()}>
                {t('signOut')}
              </button>
            )}
          </p>
        </div>
        <div className="panelx pan">
          <h3>{t('name')}</h3>
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <input
              id="pName"
              maxLength={16}
              aria-label={t('name')}
              value={name}
              disabled={!u}
              onFocus={() => setEditing(true)}
              onBlur={() => name === (u?.name ?? '') && setEditing(false)}
              onChange={(e) => {
                setEditing(true);
                setName(e.target.value);
              }}
            />
            <button className="sbtn" id="pSave" disabled={!u || busy === 'name'}>
              {t('save')}
            </button>
          </form>
          <h3>{t('avatar')}</h3>
          <div className="pick" id="avPick">
            {ownedAv.map((i) => (
              <button key={i} className={i === u?.avatar ? 'on' : ''} aria-label={t('avatarAria', { n: i + 1 })} aria-pressed={i === u?.avatar} onClick={() => equip({ avatar: i })}>
                <Avatar id={i} size={46} />
              </button>
            ))}
          </div>
          <h3>{t('frame')}</h3>
          <div className="pick" id="frPick">
            {ownedFr.map((f) => (
              <button key={f} className={f === u?.frame ? 'on' : ''} aria-label={content.frame(f)} aria-pressed={f === u?.frame} onClick={() => equip({ frame: f })}>
                <FrameSwatch css={f === 'none' || !isFrameKey(f) ? 'var(--surf2)' : FRAMES[f].css} size={46} />
              </button>
            ))}
          </div>
          {ID_ENABLED && (
            <>
              <h3>{t('language')}</h3>
              <LangSwitch />
            </>
          )}
          <WalletPanel />
        </div>
        <div className="panelx pan">
          <h3>{t('boxes')}</h3>
          <div className="boxrow" id="boxRow">
            <BoxSvg />
            <span>
              <b>{t(boxes === 1 ? 'boxCountOne' : 'boxCountMany', { n: boxes })}</b>
              <br />
              {t('boxEarn')}
            </span>
            <button className="sbtn" id="boxOpen" disabled={!boxes || busy === 'box'} onClick={openBox}>
              {t('boxOpen')}
            </button>
          </div>
        </div>
        <div className="panelx pan" id="season" style={{ gridColumn: '1/-1' }}>
          <h3>{t('season', { n: SEASON_NUMBER })}</h3>
          <p style={{ margin: 0, color: 'var(--soft)', fontSize: 14 }}>{t('seasonLede', { xp: fmt(xp) })}</p>
          <div className="track">
            {season.map((tier) => (
              <div key={tier.tier} className={`tier ${tier.claimed ? 'got' : tier.ready ? 'rdy' : ''}`}>
                <small>{t('tierXp', { n: fmt(tier.xp) })}</small>
                <b>{content.tierName(tier.reward)}</b>
                {tier.claimed ? (
                  <small>{t('claimed')}</small>
                ) : tier.ready ? (
                  <button className="sbtn" disabled={busy === 'tier' + tier.tier} onClick={() => claimTier(tier)}>
                    {t('claim')}
                  </button>
                ) : (
                  <small>{t('toGo', { n: fmt(Math.max(0, tier.xp - xp)) })}</small>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="panelx pan" id="invite" style={{ gridColumn: '1/-1' }}>
          <h3>{t('invite')}</h3>
          <p style={{ margin: 0, color: 'var(--soft)', fontSize: 14 }}>
            {t('inviteLede', { bonus: REFERRAL.invitedBonus, mine: REFERRAL.inviterBonus, runs: numWord(t, REFERRAL.rankedRunsNeeded), cap: numWord(t, REFERRAL.inviterWeeklyCap) })}
          </p>
          {u && !u.guest ? (
            <div className="copy">
              <input readOnly value={link} aria-label={t('inviteAria')} onFocus={(e) => e.currentTarget.select()} />
              <button className="sbtn" id="invCopy" onClick={() => copy(link, t('inviteCopied'))}>
                {t('inviteCopy')}
              </button>
            </div>
          ) : (
            <p style={{ margin: '10px 0 0', color: 'var(--dim)', fontSize: 13 }}>{t('inviteSignIn')}</p>
          )}
        </div>
      </div>
    </section>
  );
}

type ProfileT = Translator<keyof typeof profileEn>;

const numWord = (t: ProfileT, n: number): string => t('numbers').split(',')[n] ?? String(n);

function prizeView(p: BoxPrize, t: ProfileT, content: Content) {
  if (p.kind === 'avatar') return { art: <Avatar id={p.avatar} size={96} />, title: content.avatarTitle(p.avatar, p.name), sub: t('prize.avatar') };
  if (p.kind === 'frame')
    return {
      art: <FrameSwatch css={isFrameKey(p.frame) ? FRAMES[p.frame].css : 'var(--surf2)'} size={96} style={{ margin: '0 auto 12px' }} />,
      title: content.frame(p.frame, p.name),
      sub: t('prize.frame'),
    };
  if (p.kind === 'xp') return { art: <BoxSvg />, title: t('prize.xpTitle', { n: p.amount }), sub: t('prize.xp') };
  return { art: <BoxSvg />, title: t('prize.chipsTitle', { n: fmt(p.chips) }), sub: t('prize.chips') };
}
