import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import { FRAMES, GAMES, GAME_KEYS, MISSIONS, PREMIUM_AVATARS, nameErrorText } from '@podium/shared';
import type { NameError } from '@podium/shared';
import { ApiFailure } from '@/lib/api';
import { format, formatRich, makeT, pickLang } from './core';
import { Content, durationIn, endsText, localErrorText, localReason, tickerText } from './content';
import { commonEn } from './dict/common.en';
import { commonId } from './dict/common.id';
import { contentId } from './dict/content.id';
import { duelsEn } from './dict/duels.en';
import { duelsId } from './dict/duels.id';
import { errorsId } from './dict/errors.id';
import { homeEn } from './dict/home.en';
import { homeId } from './dict/home.id';
import { legalEn } from './dict/legal.en';
import { legalId } from './dict/legal.id';
import { pagesEn } from './dict/pages.en';
import { pagesId } from './dict/pages.id';
import { playEn } from './dict/play.en';
import { playId } from './dict/play.id';
import { profileEn } from './dict/profile.en';
import { profileId } from './dict/profile.id';
import { shopEn } from './dict/shop.en';
import { shopId } from './dict/shop.id';
import { walletEn } from './dict/wallet.en';
import { walletId } from './dict/wallet.id';

const PAIRS: [string, Record<string, string>, Record<string, string>][] = [
  ['common', commonEn, commonId],
  ['home', homeEn, homeId],
  ['duels', duelsEn, duelsId],
  ['shop', shopEn, shopId],
  ['profile', profileEn, profileId],
  ['play', playEn, playId],
  ['wallet', walletEn, walletId],
  ['pages', pagesEn, pagesId],
  ['legal', legalEn, legalId],
];
const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('pickLang', () => {
  it('uses the cookie first', () => {
    expect(pickLang('id', 'en-US')).toBe('id');
    expect(pickLang('en', 'id-ID')).toBe('en');
  });
  it('ignores a cookie that is not a language', () => {
    expect(pickLang('fr', null)).toBe('en');
    expect(pickLang('xx', 'id')).toBe('id');
  });
  it('reads Accept-Language: Indonesian picks Indonesian, anything else English', () => {
    expect(pickLang(undefined, 'id-ID,id;q=0.9,en-US;q=0.8')).toBe('id');
    expect(pickLang(undefined, 'in')).toBe('id');
    expect(pickLang(undefined, 'en-GB,en;q=0.9,id;q=0.8')).toBe('en');
    expect(pickLang(undefined, 'fr-FR,fr;q=0.9')).toBe('en');
    expect(pickLang(undefined, 'fr;q=0.9, id;q=0.7')).toBe('id');
    expect(pickLang(undefined, 'id;q=0, en;q=0.5')).toBe('en');
    expect(pickLang(undefined, '')).toBe('en');
    expect(pickLang(null, null)).toBe('en');
  });
});

describe('format', () => {
  it('fills placeholders with strings and numbers', () => {
    expect(format('Day {day} streak: +{chips} tChips', { day: 3, chips: '1,200' })).toBe('Day 3 streak: +1,200 tChips');
  });
  it('leaves unknown placeholders and text without vars alone', () => {
    expect(format('Hi {name} {who}', { name: 'Ana' })).toBe('Hi Ana {who}');
    expect(format('No vars {x}')).toBe('No vars {x}');
  });
  it('formatRich keeps elements in order', () => {
    const out = formatRich('Agree to the {terms} and the {privacy}.', { terms: 'T', privacy: 'P' });
    expect(out[0]).toBe('Agree to the ');
    expect(isValidElement(out[1])).toBe(true);
    expect(out[2]).toBe(' and the ');
    expect(out[4]).toBe('.');
    expect(out).toHaveLength(5);
  });
});

describe('makeT', () => {
  const en = { a: 'Hello {name}', b: 'Only English' } as const;
  it('English ignores the Indonesian dictionary', () => {
    expect(makeT('en', en, { a: 'Halo {name}' })('a', { name: 'Ana' })).toBe('Hello Ana');
  });
  it('Indonesian uses its text and falls back to English for a missing key', () => {
    const t = makeT('id', en, { a: 'Halo {name}' });
    expect(t('a', { name: 'Ana' })).toBe('Halo Ana');
    expect(t('b')).toBe('Only English');
    expect(makeT('id', en, null)('a', { name: 'Ana' })).toBe('Hello Ana');
    expect(t.lang).toBe('id');
  });
});

describe('dictionaries', () => {
  it.each(PAIRS)('%s: Indonesian has exactly the English keys, non-empty, same placeholders', (_area, en, id) => {
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) {
      expect(id[k]!.trim(), k).not.toBe('');
      expect(placeholders(id[k]!), k).toEqual(placeholders(en[k]!));
    }
  });
  it('game content covers every game with the same number of control rows', () => {
    const c = new Content('id', contentId);
    for (const k of GAME_KEYS) {
      const g = c.game(k);
      expect(g.ctl).toHaveLength(GAMES[k].ctl.length);
      expect(g.desc).not.toBe(GAMES[k].desc);
      expect(c.gameName(k)).toBe(GAMES[k].name);
    }
  });
  it('missions, frames, avatars and name rules are all translated', () => {
    const c = new Content('id', contentId);
    for (const m of MISSIONS) expect(c.mission(m.id)).not.toBe(m.title);
    for (const f of Object.keys(FRAMES)) expect(c.frame(f)).not.toBe(FRAMES[f as keyof typeof FRAMES].name);
    for (const a of Object.keys(PREMIUM_AVATARS)) expect(contentId.avatars[Number(a)]).toBeTruthy();
    for (const e of Object.keys(nameErrorText) as NameError[]) expect(c.nameError(e)).not.toBe(nameErrorText[e]);
  });
});

describe('Content in English', () => {
  const c = new Content('en', contentId);
  it('returns the shared English text', () => {
    expect(c.game('snake')).toEqual({ tag: GAMES.snake.tag, desc: GAMES.snake.desc, keys: GAMES.snake.keys, act: GAMES.snake.act, ctl: GAMES.snake.ctl });
    expect(c.mission('r3')).toBe('Play 3 ranked runs');
    expect(c.frame('mint')).toBe('Mint ring');
    expect(c.avatar(12, 'Crown')).toBe('Crown');
    expect(c.tierName({ kind: 'box' })).toBe('Mystery box');
    expect(c.tierName({ kind: 'avatar', avatar: 13 })).toBe('Visor avatar');
    expect(c.tierName({ kind: 'chips', amount: 150 })).toBe('150 tChips');
    expect(c.avatarTitle(15, 'Wizard')).toBe('Wizard avatar');
    expect(c.fx('Boss down')).toBe('Boss down');
  });
  it('translates in Indonesian, including the "Level N" pattern', () => {
    const i = new Content('id', contentId);
    expect(i.tierName({ kind: 'avatar', avatar: 13 })).toBe('Avatar Visor');
    expect(i.tierName({ kind: 'frame', frame: 'aurora' })).toBe('Cincin Aurora');
    expect(i.fx('Level 4')).toBe('Level 4');
    expect(i.fx('Extra life')).toBe('Nyawa tambahan');
    expect(i.fx('Unknown word')).toBe('Unknown word');
  });
});

describe('API errors', () => {
  const fail = (code: ConstructorParameters<typeof ApiFailure>[0], msg: string) => new ApiFailure(code, msg, 400);
  it('English shows the server message as before', () => {
    expect(localErrorText(fail('conflict', 'That name is taken.'), 'en', errorsId)).toBe('That name is taken.');
    expect(localErrorText(new Error('x'), 'en', errorsId)).toBe('Something went wrong. Please try again.');
  });
  it('Indonesian: exact message, then pattern, then code, then the server text', () => {
    expect(localErrorText(fail('conflict', 'That name is taken.'), 'id', errorsId)).toBe('Nama itu sudah dipakai.');
    expect(localErrorText(fail('rewards_locked', 'Play 2 more ranked runs to unlock rewards.'), 'id', errorsId)).toBe('Mainkan 2 run ranked lagi untuk membuka hadiah.');
    expect(localErrorText(fail('conflict', 'Refill opens once you are under 100 tChips.'), 'id', errorsId)).toBe('Isi ulang tersedia saat saldomu di bawah 100 tChips.');
    expect(localErrorText(fail('rate_limited', 'Slow down, new wording.'), 'id', errorsId)).toBe(errorsId.byCode.rate_limited);
    expect(localErrorText(fail('invalid', 'A brand new message.'), 'id', errorsId)).toBe('A brand new message.');
    expect(localErrorText(new Error('x'), 'id', errorsId)).toBe('Terjadi kesalahan. Silakan coba lagi.');
    expect(localErrorText(fail('network', 'Network error. Check your connection and try again.'), 'id', null)).toBe('Network error. Check your connection and try again.');
  });
  it('run reasons', () => {
    expect(localReason('session expired', 'id', errorsId)).toBe('sesi kedaluwarsa');
    expect(localReason('session expired', 'en', errorsId)).toBe('session expired');
    expect(localReason('something new', 'id', errorsId)).toBe('something new');
  });
});

describe('server-built text', () => {
  it('ticker sentences', () => {
    const en = makeT('en', commonEn);
    const id = makeT('id', commonEn, commonId);
    expect(tickerText('scored 1,234 in', en)).toBe('scored 1,234 in');
    expect(tickerText('scored 1,234 in', id)).toBe('mencetak 1,234 di');
    expect(tickerText('won a duel in', id)).toBe('memenangkan duel di');
    expect(tickerText('did something else', id)).toBe('did something else');
  });
  it('countdowns and durations keep the English output', () => {
    const en = makeT('en', commonEn);
    const id = makeT('id', commonEn, commonId);
    const now = Date.UTC(2026, 0, 1);
    const to = now + ((3 * 24 + 10) * 60 + 5) * 60_000;
    expect(endsText(en, 'long', to, now)).toBe('3 days 10 hours');
    expect(endsText(en, 'short', to, now)).toBe('3d 10h 5m');
    expect(endsText(en, 'cup', to, now)).toBe('3d 10h');
    expect(endsText(id, 'long', to, now)).toBe('3 hari 10 jam');
    expect(durationIn(en, 7 * 86_400)).toBe('7 days');
    expect(durationIn(en, 3600)).toBe('1 hour');
    expect(durationIn(en, 0)).toBe('no delay');
    expect(durationIn(id, 300)).toBe('5 menit');
  });
});
