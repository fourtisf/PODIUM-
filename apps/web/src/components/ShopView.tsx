'use client';
// Shop: mystery box, premium avatars, frames. Prices and the burn counter come from the server.
import { useEffect, useState } from 'react';
import { ECONOMY, FRAMES, PAID_FRAMES, PREMIUM_AVATARS, fmt, isFrameKey } from '@podium/shared';
import type { ShopBuyRequest, ShopResponse } from '@podium/shared';
import { api } from '@/lib/api';
import { useContent, useT } from '@/i18n/client';
import { shopEn } from '@/i18n/dict/shop.en';
import { useSession } from './Session';
import { Avatar, BoxSvg, FrameSwatch } from './ui';

/** The catalogue before the API answers (and when it is down): same items, nothing owned. */
const fallbackShop = (): ShopResponse => ({
  burned: 0,
  box: { price: ECONOMY.boxPrice },
  avatars: Object.entries(PREMIUM_AVATARS).map(([id, p]) => ({ id: +id, name: p.name, price: p.price, owned: false })),
  frames: PAID_FRAMES.map((k) => ({ id: k, name: FRAMES[k].name, price: FRAMES[k].price, owned: false })),
});

function Item({ art, name, sub, owned, price, busy, onBuy }: { art: React.ReactNode; name: string; sub: string; owned: boolean; price: number; busy: boolean; onBuy(): void }) {
  const t = useT('shop', shopEn);
  return (
    <div className="item">
      {art}
      <b>{name}</b>
      <small>{sub}</small>
      <button className={`sbtn ${owned ? 'lt' : ''}`} disabled={owned || busy} onClick={onBuy} aria-label={owned ? t('ownedAria', { name }) : t('buyAria', { name, n: fmt(price) })}>
        {owned ? t('owned') : t('price', { n: fmt(price) })}
      </button>
    </div>
  );
}

export function ShopView({ initial }: { initial: ShopResponse | null }) {
  const s = useSession();
  const t = useT('shop', shopEn);
  const content = useContent();
  const [shop, setShop] = useState<ShopResponse>(initial ?? fallbackShop());
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (initial) setShop(initial);
  }, [initial]);
  const uid = s.me?.user.id;
  useEffect(() => {
    api.shop().then(setShop, () => undefined);
  }, [uid]);

  const buy = async (req: ShopBuyRequest, price: number) => {
    const key = `${req.kind}:${req.id ?? ''}`;
    if (busy || !s.needAccount()) return;
    if (s.me && s.me.user.balance < price) {
      s.toast(t('low'));
      return;
    }
    setBusy(key);
    try {
      const r = await api.shopBuy(req);
      s.patchUser({ balance: r.balance, boxes: r.boxes });
      if (req.kind === 'box') s.toast(t('boxBought'));
      else {
        // Equip what was just bought, as the prototype does.
        try {
          await api.patchMe(req.kind === 'avatar' ? { avatar: Number(req.id) } : { frame: String(req.id) });
          s.toast(t('equipped'));
        } catch {
          s.toast(t('bought'));
        }
      }
      await Promise.all([s.refresh(), api.shop().then(setShop, () => undefined)]);
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="view on" id="v-shop">
      <h1>{t('title')}</h1>
      <p className="lede">
        {t.rich('lede', {
          n: (
            <b className="num" id="burnT" style={{ color: 'var(--ink)' }}>
              {fmt(shop.burned)}
            </b>
          ),
        })}
      </p>
      <div className="shopg" id="shopG">
        <Item art={<BoxSvg size={56} />} name={t('box')} sub={t('boxSub')} owned={false} price={shop.box.price} busy={busy === 'box:'} onBuy={() => buy({ kind: 'box' }, shop.box.price)} />
        {shop.avatars.map((a) => (
          <Item key={a.id} art={<Avatar id={a.id} size={56} />} name={content.avatar(a.id, a.name)} sub={t('avatar')} owned={a.owned} price={a.price} busy={busy === `avatar:${a.id}`} onBuy={() => buy({ kind: 'avatar', id: a.id }, a.price)} />
        ))}
        {shop.frames.map((f) => (
          <Item
            key={f.id}
            art={<FrameSwatch css={isFrameKey(f.id) ? FRAMES[f.id].css : 'var(--surf2)'} />}
            name={content.frame(f.id, f.name)}
            sub={t('frame')}
            owned={f.owned}
            price={f.price}
            busy={busy === `frame:${f.id}`}
            onBuy={() => buy({ kind: 'frame', id: f.id }, f.price)}
          />
        ))}
      </div>
    </section>
  );
}
