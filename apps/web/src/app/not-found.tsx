import Link from 'next/link';
import { serverT } from '@/i18n/server';

export default function NotFound() {
  const t = serverT('pages');
  return (
    <main className="wrap">
      <section className="view on">
        <h1>{t('nf.title')}</h1>
        <p className="lede">{t('nf.lede')}</p>
        <p style={{ marginTop: 22 }}>
          <Link className="sbtn" href="/" style={{ textDecoration: 'none' }}>
            {t('nf.back')}
          </Link>
        </p>
      </section>
    </main>
  );
}
