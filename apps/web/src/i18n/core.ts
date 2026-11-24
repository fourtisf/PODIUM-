// The i18n layer: two languages, typed dictionaries, `{name}` interpolation. No dependency.
// English is the source of truth. Each Indonesian dictionary is checked to have every key of its
// English twin (`satisfies Dict<typeof en>`), so a missing translation is a type error.
import { Fragment, createElement, type ReactNode } from 'react';

export const LANGS = ['en', 'id'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';
/** The cookie that holds the visitor's choice. Server components read it, so the first paint is right. */
export const LANG_COOKIE = 'lang';

/**
 * Indonesian is built in but switched off: the site is English only unless NEXT_PUBLIC_ENABLE_ID=on
 * at build time. When off, the language switch is hidden and every visitor gets English.
 */
export const ID_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ID === 'on';

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'id';

/** A translation of an English dictionary: same keys, string values. */
export type Dict<E> = { readonly [K in keyof E]: string };
export type Vars = Record<string, string | number>;

/** The cookie wins; without one, an Accept-Language that prefers Indonesian over English picks Indonesian. */
export function pickLang(cookie: string | null | undefined, acceptLanguage?: string | null): Lang {
  if (isLang(cookie)) return cookie;
  if (!acceptLanguage) return DEFAULT_LANG;
  const prefs = acceptLanguage
    .split(',')
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().toLowerCase().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const w = q ? Number(q.slice(2)) : 1;
      return { base: tag.split('-')[0]!, w: Number.isFinite(w) ? w : 0, i };
    })
    .filter((p) => p.base && p.w > 0)
    .sort((a, b) => b.w - a.w || a.i - b.i);
  for (const p of prefs) {
    if (p.base === 'id' || p.base === 'in') return 'id';
    if (p.base === 'en') return 'en';
  }
  return DEFAULT_LANG;
}

/** Replaces `{name}` with vars.name. Unknown placeholders are left as they are. */
export function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

/** Like format, but values may be elements (links, bold text). Returns text and nodes in order. */
export function formatRich(template: string, vars: Record<string, ReactNode>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(template))) {
    const k = m[1]!;
    if (!Object.prototype.hasOwnProperty.call(vars, k)) continue;
    if (m.index > last) out.push(template.slice(last, m.index));
    out.push(createElement(Fragment, { key: 'v' + n++ }, vars[k]));
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return out;
}

export interface Translator<K extends string> {
  (key: K, vars?: Vars): string;
  rich(key: K, vars: Record<string, ReactNode>): ReactNode[];
  lang: Lang;
}

/** A t() for one dictionary: the Indonesian text when there is one, else the English. */
export function makeT<E extends Record<string, string>>(lang: Lang, en: E, id?: Partial<Record<keyof E, string>> | null): Translator<Extract<keyof E, string>> {
  const pick = (key: Extract<keyof E, string>): string => (lang === 'id' && id && typeof id[key] === 'string' ? id[key]! : en[key] ?? key);
  const t = ((key, vars) => format(pick(key), vars)) as Translator<Extract<keyof E, string>>;
  t.rich = (key, vars) => formatRich(pick(key), vars);
  t.lang = lang;
  return t;
}
