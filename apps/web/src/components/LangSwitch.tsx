'use client';
// EN / ID switch (footer and profile). The choice goes in the `lang` cookie so the server renders
// the next page in that language on first paint; the current page re-renders from the server.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LANG_COOKIE, LANGS, type Lang } from '@/i18n/core';
import { useLang, useT } from '@/i18n/client';
import { commonEn } from '@/i18n/dict/common.en';

export function LangSwitch({ className = '' }: { className?: string }) {
  const lang = useLang();
  const t = useT('common', commonEn);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const choose = (l: Lang) => {
    if (l === lang || busy) return;
    setBusy(true);
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    router.refresh();
    setTimeout(() => setBusy(false), 600);
  };
  return (
    <span className={`seg langsw ${className}`} role="group" aria-label={t('lang.label')}>
      {LANGS.map((l) => (
        <button key={l} type="button" lang={l} className={l === lang ? 'on' : ''} aria-pressed={l === lang} title={t(l === 'en' ? 'lang.en' : 'lang.id')} onClick={() => choose(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
