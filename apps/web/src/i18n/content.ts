// Language-aware views of shared constants and server text. Pure functions (no React), so they are
// unit-tested and usable from client and server alike. English always comes from packages/shared
// or from the server unchanged; Indonesian comes from the dictionaries passed in.
import { FRAMES, GAMES, PREMIUM_AVATARS, countdown, gameMeta, isFrameKey, missionDef, nameErrorText } from '@podium/shared';
import type { GameKey, NameError, SeasonReward } from '@podium/shared';
import { ApiFailure, errorText } from '@/lib/api';
import { format, type Lang, type Vars } from './core';
import type { commonEn } from './dict/common.en';
import type { ContentId } from './dict/content.id';
import type { ErrorsId } from './dict/errors.id';

export interface GameCopy {
  tag: string;
  desc: string;
  keys: string;
  act: string;
  ctl: readonly (readonly [string, string])[];
}

export class Content {
  constructor(
    readonly lang: Lang,
    private readonly id: ContentId | null | undefined,
  ) {}
  private get on(): ContentId | null {
    return this.lang === 'id' && this.id ? this.id : null;
  }
  game(k: GameKey): GameCopy {
    const g = gameMeta(k);
    const t = this.on?.games[k];
    return t ? { tag: t.tag, desc: t.desc, keys: t.keys, act: t.act, ctl: t.ctl as GameCopy['ctl'] } : { tag: g.tag, desc: g.desc, keys: g.keys, act: g.act, ctl: g.ctl };
  }
  /** Game names are brand names: the same in every language. */
  gameName(k: GameKey): string {
    return GAMES[k].name;
  }
  mission(id: string, fallback?: string): string {
    const t = (this.on?.missions as Record<string, string> | undefined)?.[id];
    return t ?? fallback ?? missionDef(id)?.title ?? id;
  }
  frame(k: string, fallback?: string): string {
    if (!isFrameKey(k)) return fallback ?? k;
    return this.on?.frames[k] ?? fallback ?? FRAMES[k].name;
  }
  avatar(id: number, fallback?: string): string {
    return this.on?.avatars[id] ?? fallback ?? PREMIUM_AVATARS[id]?.name ?? '';
  }
  tierName(r: SeasonReward): string {
    const t = this.on?.tiers;
    if (!t) {
      return r.kind === 'chips' ? `${r.amount} tChips` : r.kind === 'box' ? 'Mystery box' : r.kind === 'frame' ? FRAMES[r.frame].name : `${PREMIUM_AVATARS[r.avatar]?.name ?? 'Rare'} avatar`;
    }
    if (r.kind === 'chips') return format(t.chips, { n: r.amount });
    if (r.kind === 'box') return t.box;
    if (r.kind === 'frame') return this.frame(r.frame);
    return format(t.avatar, { name: this.on?.avatars[r.avatar] ?? t.rare });
  }
  /** "Crown avatar": a premium avatar's display title, from the server's English name. */
  avatarTitle(id: number, name: string): string {
    const t = this.on?.tiers;
    return t ? format(t.avatar, { name: this.on?.avatars[id] ?? name }) : `${name} avatar`;
  }
  nameError(e: NameError): string {
    return this.on?.nameErrors[e] ?? nameErrorText[e];
  }
  brandLine(en: string): string {
    return this.on?.brandLine ?? en;
  }
  /** Words a game flashes on the stage. */
  fx(text: string): string {
    const fx = this.on?.fx;
    if (!fx) return text;
    if (fx[text]) return fx[text]!;
    const lv = /^Level (\d+)$/.exec(text);
    return lv && fx.level ? format(fx.level, { n: lv[1]! }) : text;
  }
}

/** The toast text for anything thrown by an API call, in the visitor's language. */
export function localErrorText(e: unknown, lang: Lang, ids: ErrorsId | null | undefined): string {
  if (lang !== 'id' || !ids) return errorText(e);
  if (!(e instanceof ApiFailure)) return ids.byMessage['Something went wrong. Please try again.'] ?? errorText(e);
  const exact = ids.byMessage[e.message];
  if (exact) return exact;
  for (const [src, rep] of ids.patterns) {
    const re = new RegExp(src);
    if (re.test(e.message)) return e.message.replace(re, rep);
  }
  const byCode = (ids.byCode as Record<string, string | undefined>)[e.code];
  return byCode ?? e.message;
}

/** A run-refusal or stream-end reason from the server. */
export function localReason(reason: string, lang: Lang, ids: ErrorsId | null | undefined): string {
  return (lang === 'id' && ids?.reasons[reason]) || reason;
}

/** The activity ticker's sentence fragment ("scored 1,234 in"). The server stores it in English. */
export function tickerText(text: string, t: (key: 'tick.scored' | 'tick.wonDuel', vars?: Record<string, string>) => string): string {
  const m = /^scored ([\d,]+) in$/.exec(text);
  if (m) return t('tick.scored', { n: m[1]! });
  if (text === 'won a duel in') return t('tick.wonDuel');
  return text;
}

type CommonKey = keyof typeof commonEn;
type CommonT = (key: CommonKey, vars?: Vars) => string;

/** "3 days 10 hours" (home), "3d 10h 5m" (leaderboard), "6d 10h" (Cup banner). */
export function endsText(t: CommonT, kind: 'long' | 'short' | 'cup', to: string | number | Date, now: number): string {
  const e = countdown(new Date(to), now);
  return t(kind === 'long' ? 'ends.long' : kind === 'short' ? 'ends.short' : 'ends.cup', { d: e.d, h: e.h, m: e.m });
}

/** "7 days", "36 hours", "5 minutes". */
export function durationIn(t: CommonT, seconds: number): string {
  const unit = (n: number, one: CommonKey, many: CommonKey): string => t(n === 1 ? one : many, { n });
  if (seconds <= 0) return t('dur.none');
  if (seconds % 86_400 === 0) return unit(seconds / 86_400, 'dur.day', 'dur.days');
  if (seconds >= 3600) return unit(Math.round(seconds / 3600), 'dur.hour', 'dur.hours');
  if (seconds >= 60) return unit(Math.round(seconds / 60), 'dur.minute', 'dur.minutes');
  return unit(seconds, 'dur.second', 'dur.seconds');
}
