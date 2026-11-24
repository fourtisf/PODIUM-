import type { Dict } from '../core';
import type { shopEn } from './shop.en';

export const shopId = {
  'ownedAria': '{name}, sudah dimiliki',
  'buyAria': 'Beli {name} seharga {n} tChips',
  'owned': 'Dimiliki',
  'price': '{n} tChips',
  'low': 'tChips-mu tidak cukup untuk itu.',
  'boxBought': 'Kotak Misteri dibeli. Buka dari profilmu.',
  'equipped': 'Dibeli dan langsung dipakai.',
  'bought': 'Dibeli. Pakai dari profilmu.',
  'title': 'Toko',
  'lede': 'Belanjakan tChips untuk avatar, bingkai, dan Kotak Misteri. Sepersepuluh dari setiap pembelian dibakar: {n} tChips sejauh ini.',
  'box': 'Kotak Misteri',
  'boxSub': 'tChips, XP, atau kosmetik langka',
  'avatar': 'Avatar',
  'frame': 'Bingkai profil',
} as const satisfies Dict<typeof shopEn>;
