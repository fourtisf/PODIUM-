'use client';
// Client side of the i18n layer. The root layout (a server component) reads the `lang` cookie and
// passes the language here, plus the Indonesian dictionaries when the language is Indonesian, so
// they travel in the page data and never in the JavaScript bundle. English dictionaries are
// imported by the components that use them, as the inline strings were before.
import { createContext, useContext, useMemo } from 'react';
import { makeT, type Lang, type Translator } from './core';
import { Content, localErrorText, localReason } from './content';
import type { commonEn } from './dict/common.en';
import type { commonId } from './dict/common.id';
import type { ContentId } from './dict/content.id';
import type { duelsEn } from './dict/duels.en';
import type { duelsId } from './dict/duels.id';
import type { ErrorsId } from './dict/errors.id';
import type { homeEn } from './dict/home.en';
import type { homeId } from './dict/home.id';
import type { playEn } from './dict/play.en';
import type { playId } from './dict/play.id';
import type { profileEn } from './dict/profile.en';
import type { profileId } from './dict/profile.id';
import type { shopEn } from './dict/shop.en';
import type { shopId } from './dict/shop.id';
import type { walletEn } from './dict/wallet.en';
import type { walletId } from './dict/wallet.id';

/** English dictionary of each client area. */
export interface ClientEn {
  common: typeof commonEn;
  home: typeof homeEn;
  duels: typeof duelsEn;
  shop: typeof shopEn;
  profile: typeof profileEn;
  play: typeof playEn;
  wallet: typeof walletEn;
}
export type ClientArea = keyof ClientEn;

/** Indonesian dictionaries of the page areas: sent only with the page that uses them (IdArea). */
export interface IdAreas {
  home: typeof homeId;
  duels: typeof duelsId;
  shop: typeof shopId;
  profile: typeof profileId;
  play: typeof playId;
}

/** What the root layout sends for an Indonesian page, plus whatever areas the page adds. */
export interface IdBundle extends Partial<IdAreas> {
  common: typeof commonId;
  wallet?: typeof walletId;
  content: ContentId;
  errors: ErrorsId;
}

interface LangValue {
  lang: Lang;
  id: IdBundle | null;
}

const LangCtx = createContext<LangValue>({ lang: 'en', id: null });

export function LangProvider({ lang, id, children }: { lang: Lang; id: IdBundle | null; children: React.ReactNode }) {
  const value = useMemo<LangValue>(() => ({ lang, id: lang === 'id' ? id : null }), [lang, id]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

/** Adds a page's own Indonesian dictionaries to the ones from the root layout. */
export function LangExtend({ id, children }: { id: Partial<IdAreas>; children: React.ReactNode }) {
  const parent = useContext(LangCtx);
  const value = useMemo<LangValue>(() => (parent.lang === 'id' && parent.id ? { lang: parent.lang, id: { ...parent.id, ...id } } : parent), [parent, id]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export const useLang = (): Lang => useContext(LangCtx).lang;

/** t() for one area: `const t = useT('home', homeEn)`. */
export function useT<A extends ClientArea>(area: A, en: ClientEn[A]): Translator<Extract<keyof ClientEn[A], string>> {
  const { lang, id } = useContext(LangCtx);
  const dict = (id?.[area] ?? null) as Partial<Record<keyof ClientEn[A], string>> | null;
  return useMemo(() => makeT(lang, en, dict), [lang, en, dict]);
}

/** Shared-constant text (game descriptions, controls, missions, cosmetics) in the current language. */
export function useContent(): Content {
  const { lang, id } = useContext(LangCtx);
  return useMemo(() => new Content(lang, id?.content), [lang, id]);
}

/** Error and reason text for API failures in the current language. */
export function useErrors(): { text(e: unknown): string; reason(r: string): string } {
  const { lang, id } = useContext(LangCtx);
  return useMemo(() => ({ text: (e: unknown) => localErrorText(e, lang, id?.errors), reason: (r: string) => localReason(r, lang, id?.errors) }), [lang, id]);
}
