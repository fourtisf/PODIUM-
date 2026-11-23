'use client';
// Profile: level ring, stats, name, avatar and frame pickers, mystery boxes, Season track, invite link.
import { useEffect, useState } from 'react';
import { FRAMES, GAMES, GAME_KEYS, REFERRAL, SEASON, SEASON_NUMBER, cleanName, fmt, isFrameKey, levelCeil, levelFloor, nameErrorText, validateName } from '@podium/shared';
import type { BoxPrize, GameKey, GamesResponse, SeasonTierState } from '@podium/shared';
import { api } from '@/lib/api';
import { beep } from '@/lib/audio';
import { tierName } from '@/lib/format';
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
        s.toast(nameErrorText[bad]);
        return;
      }
      await api.patchMe({ name: v });
      setEditing(false);
      await s.refresh();
      s.toast('Name saved.');
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
      s.reveal(prizeView(r.prize));
      beep(660, 0.1, 'sine', 0.05);
      await s.refresh();
    });
  };
  const claimTier = (t: SeasonTierState) => {
    if (!s.needAccount()) return;
    void run('tier' + t.tier, async () => {
      const r = await api.claimSeason(t.tier);
      s.patchUser({ balance: r.balance, boxes: r.boxes });
      s.toast('Season reward: ' + (r.fallback ? `${fmt(r.chips)} tChips (you already own that item)` : r.reward.kind === 'chips' ? `${fmt(r.chips)} tChips` : tierName(r.reward)));
      await s.refresh();
    });
  };
  const copy = (t: string, ok: string) => {
    const bad = () => s.toast('Copy failed. Select the link and copy it manually.');
    try {
      navigator.clipboard.writeText(t).then(() => s.toast(ok), bad);
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
      <h1>Your profile</h1>
      <div className="prof">
        <div className="panelx">
          <div className="lvl">
            <div className="ring" id="ring" style={{ ['--p' as string]: `${next > base ? ((xp - base) / (next - base)) * 100 : 0}%` }}>
              <span id="lv">{lv}</span>
            </div>
            <div>
              <h2 id="lvT">Level {lv}</h2>
              <div style={{ color: 'var(--soft)' }} id="xpT">
                {fmt(xp)} XP, {fmt(Math.max(0, next - xp))} to level {lv + 1}
              </div>
              <div style={{ color: 'var(--dim)', fontSize: 14, marginTop: 4 }} id="boxT">
                {boxes ? `${boxes} mystery ${boxes > 1 ? 'boxes' : 'box'} kept` : 'No mystery boxes yet'}
              </div>
            </div>
          </div>
        </div>
        <div className="panelx">
          <div className="statg" id="stats">
            {kv('Plays', fmt(u?.stats.plays ?? 0))}
            {kv('Entry fees', fmt(u?.stats.spent ?? 0))}
            {kv('Prizes won', fmt(u?.stats.won ?? 0))}
            {kv('Net', (net > 0 ? '+' : '') + fmt(net))}
            {GAME_KEYS.map((k) => kv('Best in ' + GAMES[k].name, fmt(bests[k] ?? 0)))}
          </div>
          <p className="acct">
            {!u || u.guest ? (
              <>
                <button className="ghost" onClick={s.openSignIn}>
                  Sign in
                </button>
                <span>Sign in to play ranked and keep your progress.</span>
              </>
            ) : (
              <button className="ghost" onClick={() => void s.signOut()}>
                Sign out
              </button>
            )}
          </p>
        </div>
        <div className="panelx pan">
          <h3>Name</h3>
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
              aria-label="Name"
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
              Save
            </button>
          </form>
          <h3>Avatar</h3>
          <div className="pick" id="avPick">
            {ownedAv.map((i) => (
              <button key={i} className={i === u?.avatar ? 'on' : ''} aria-label={`Avatar ${i + 1}`} aria-pressed={i === u?.avatar} onClick={() => equip({ avatar: i })}>
                <Avatar id={i} size={46} />
              </button>
            ))}
          </div>
          <h3>Frame</h3>
          <div className="pick" id="frPick">
            {ownedFr.map((f) => (
              <button key={f} className={f === u?.frame ? 'on' : ''} aria-label={isFrameKey(f) ? FRAMES[f].name : f} aria-pressed={f === u?.frame} onClick={() => equip({ frame: f })}>
                <FrameSwatch css={f === 'none' || !isFrameKey(f) ? 'var(--surf2)' : FRAMES[f].css} size={46} />
              </button>
            ))}
          </div>
        </div>
        <div className="panelx pan">
          <h3>Mystery boxes</h3>
          <div className="boxrow" id="boxRow">
            <BoxSvg />
            <span>
              <b>
                {boxes} mystery {boxes === 1 ? 'box' : 'boxes'}
              </b>
              <br />
              Earn them from missions, streaks and ranked runs.
            </span>
            <button className="sbtn" id="boxOpen" disabled={!boxes || busy === 'box'} onClick={openBox}>
              Open one
            </button>
          </div>
        </div>
        <div className="panelx pan" id="season" style={{ gridColumn: '1/-1' }}>
          <h3>Season {SEASON_NUMBER}</h3>
          <p style={{ margin: 0, color: 'var(--soft)', fontSize: 14 }}>Every XP you earn moves you along the track. {fmt(xp)} XP so far.</p>
          <div className="track">
            {season.map((t) => (
              <div key={t.tier} className={`tier ${t.claimed ? 'got' : t.ready ? 'rdy' : ''}`}>
                <small>{fmt(t.xp)} XP</small>
                <b>{tierName(t.reward)}</b>
                {t.claimed ? (
                  <small>Claimed</small>
                ) : t.ready ? (
                  <button className="sbtn" disabled={busy === 'tier' + t.tier} onClick={() => claimTier(t)}>
                    Claim
                  </button>
                ) : (
                  <small>{fmt(Math.max(0, t.xp - xp))} to go</small>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="panelx pan" id="invite" style={{ gridColumn: '1/-1' }}>
          <h3>Invite friends</h3>
          <p style={{ margin: 0, color: 'var(--soft)', fontSize: 14 }}>
            A friend who signs up through your link starts with {REFERRAL.invitedBonus} extra tChips. Your own {REFERRAL.inviterBonus} tChips arrive after they complete {numWord(REFERRAL.rankedRunsNeeded)} ranked runs, for up to {numWord(REFERRAL.inviterWeeklyCap)} friends a week.
          </p>
          {u && !u.guest ? (
            <div className="copy">
              <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
              <button className="sbtn" id="invCopy" onClick={() => copy(link, 'Invite link copied.')}>
                Copy link
              </button>
            </div>
          ) : (
            <p style={{ margin: '10px 0 0', color: 'var(--dim)', fontSize: 13 }}>Sign in to get your invite link.</p>
          )}
        </div>
      </div>
    </section>
  );
}

const numWord = (n: number): string => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n);

function prizeView(p: BoxPrize) {
  if (p.kind === 'avatar') return { art: <Avatar id={p.avatar} size={96} />, title: `${p.name} avatar`, sub: 'A rare avatar. Equip it from your profile.' };
  if (p.kind === 'frame')
    return {
      art: <FrameSwatch css={isFrameKey(p.frame) ? FRAMES[p.frame].css : 'var(--surf2)'} size={96} style={{ margin: '0 auto 12px' }} />,
      title: p.name,
      sub: 'A profile frame. Equip it from your profile.',
    };
  if (p.kind === 'xp') return { art: <BoxSvg />, title: `+${p.amount} XP`, sub: 'Straight to your level.' };
  return { art: <BoxSvg />, title: `+${fmt(p.chips)} tChips`, sub: 'Added to your balance.' };
}
