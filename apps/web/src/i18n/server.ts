// Server side of the i18n layer: the visitor's language from the `lang` cookie, else from
// Accept-Language; t() for server components; the Indonesian bundle for the client provider.
import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { CHAIN_ON } from '@/lib/chain';
import { LANG_COOKIE, makeT, pickLang, type Lang } from './core';
import { Content } from './content';
import type { IdAreas, IdBundle } from './client';
import { commonEn } from './dict/common.en';
import { commonId } from './dict/common.id';
import { contentId } from './dict/content.id';
import { duelsId } from './dict/duels.id';
import { errorsId } from './dict/errors.id';
import { homeId } from './dict/home.id';
import { legalEn } from './dict/legal.en';
import { legalId } from './dict/legal.id';
import { pagesEn } from './dict/pages.en';
import { pagesId } from './dict/pages.id';
import { playId } from './dict/play.id';
import { profileId } from './dict/profile.id';
import { shopId } from './dict/shop.id';
import { walletId } from './dict/wallet.id';

export const getLang = cache((): Lang => pickLang(cookies().get(LANG_COOKIE)?.value, headers().get('accept-language')));

const SERVER = {
  pages: [pagesEn, pagesId],
  legal: [legalEn, legalId],
  common: [commonEn, commonId],
} as const;

/** t() for a server component: `const t = serverT('pages')`. */
export function serverT<A extends keyof typeof SERVER>(area: A) {
  const [en, id] = SERVER[area];
  return makeT(getLang(), en as (typeof SERVER)[A][0], id as Partial<Record<keyof (typeof SERVER)[A][0], string>>);
}

export const serverContent = (): Content => new Content(getLang(), contentId);

/** What every Indonesian page needs in the browser (wallet text only in chain builds). Page areas come from IdArea. */
export function idBundle(): IdBundle {
  return { common: commonId, ...(CHAIN_ON ? { wallet: walletId } : {}), content: contentId, errors: errorsId };
}

const AREAS: IdAreas = { home: homeId, duels: duelsId, shop: shopId, profile: profileId, play: playId };

/** The Indonesian dictionaries of some page areas, or null for an English page. */
export function idAreas(areas: (keyof IdAreas)[]): Partial<IdAreas> | null {
  if (getLang() !== 'id') return null;
  return Object.fromEntries(areas.map((a) => [a, AREAS[a]])) as Partial<IdAreas>;
}
