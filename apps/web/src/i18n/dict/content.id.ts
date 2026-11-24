// Indonesian for text that lives in packages/shared (English there stays the source): game
// descriptions and controls, missions, cosmetics, name rules, and in-game effect words.
// Keyed by the shared ids, so a new game, mission or item is a type error here until translated.
// Game names are brand names and stay English; so do "tChips" and the brand.
import type { FrameKey, GAMES, GameKey, MissionId, NameError } from '@podium/shared';

type Pairs<T extends readonly unknown[]> = { readonly [I in keyof T]: readonly [string, string] };
type Ctl<K extends GameKey> = Pairs<(typeof GAMES)[K]['ctl']>;
export type GameText<K extends GameKey = GameKey> = { tag: string; desc: string; keys: string; act: string; ctl: Ctl<K> };

export const contentId = {
  /** BRAND.line. */
  brandLine: 'Game keterampilan dengan pool hadiah mingguan',
  games: {
    traffic: {
      tag: '3D',
      desc: 'Meliuk di antara tiga lajur lalu lintas. Makin jauh kamu melaju, makin cepat jalannya.',
      keys: 'Panah kiri/kanan, atau ketuk salah satu sisi',
      act: 'Mulai',
      ctl: [
        ['← →', 'Pindah lajur'],
        ['Ketuk kiri / kanan', 'Pindah lajur di ponsel'],
      ],
    },
    duck: {
      tag: 'Refleks',
      desc: 'Mendayung menyusuri sungai dan hindari batang kayu.',
      keys: 'Panah kiri/kanan, atau geser',
      act: 'Mulai',
      ctl: [
        ['← →', 'Bergerak'],
        ['Geser', 'Bergerak di ponsel'],
      ],
    },
    blade: {
      tag: 'Timing',
      desc: 'Musuh mendekat dari dua sisi. Tebas tepat saat mereka masuk jangkauan.',
      keys: 'Panah kiri/kanan, atau ketuk salah satu sisi',
      act: 'Mulai',
      ctl: [
        ['←', 'Tebas ke kiri'],
        ['→', 'Tebas ke kanan'],
        ['Meleset', 'Terkunci sesaat'],
      ],
    },
    glide: {
      tag: 'Presisi',
      desc: 'Terbang menembus badai, menyelinap di celah-celah es.',
      keys: 'Spasi atau ketuk untuk naik',
      act: 'Naik',
      ctl: [
        ['Spasi', 'Naik'],
        ['Ketuk', 'Naik di ponsel'],
      ],
    },
    stack: {
      tag: 'Timing',
      desc: 'Jatuhkan setiap balok tepat di atas balok di bawahnya. Meleset dari tepi, baloknya terpotong.',
      keys: 'Spasi atau ketuk untuk jatuhkan balok',
      act: 'Jatuhkan',
      ctl: [
        ['Spasi', 'Jatuhkan balok'],
        ['Ketuk', 'Jatuhkan di ponsel'],
        ['Jatuh sempurna', 'Lebar balok tetap utuh'],
      ],
    },
    hop: {
      tag: 'Arcade',
      desc: 'Melompat dari awan ke awan dan naik setinggi mungkin.',
      keys: 'Panah kiri/kanan, atau geser',
      act: 'Mulai',
      ctl: [
        ['← →', 'Bergerak'],
        ['Geser', 'Bergerak di ponsel'],
        ['Tepi layar', 'Muncul di sisi seberang'],
      ],
    },
    snake: {
      tag: 'Klasik',
      desc: 'Makan, tumbuh, dan jangan menabrak tubuhmu sendiri. Makin panjang, makin cepat.',
      keys: 'Panah kiri/kanan untuk berbelok, atau ketuk salah satu sisi',
      act: 'Mulai',
      ctl: [
        ['←', 'Belok kiri'],
        ['→', 'Belok kanan'],
        ['Ketuk kiri / kanan', 'Belok di ponsel'],
      ],
    },
    sprint: {
      tag: 'Runner',
      desc: 'Berlari di atas atap dan lompati duri. Kamu punya satu lompatan tambahan di udara.',
      keys: 'Spasi atau ketuk untuk lompat, lagi di udara untuk lompat ganda',
      act: 'Lompat',
      ctl: [
        ['Spasi', 'Lompat'],
        ['Spasi di udara', 'Lompatan ganda'],
        ['Ketuk', 'Lompat di ponsel'],
      ],
    },
    hoop: {
      tag: 'Timing',
      desc: 'Ringnya terus bergeser. Tembak saat posisinya pas. Tiga kali meleset, kamu gugur.',
      keys: 'Spasi atau ketuk untuk menembak',
      act: 'Tembak',
      ctl: [
        ['Spasi', 'Tembak'],
        ['Ketuk', 'Tembak di ponsel'],
        ['Tiga kali meleset', 'Run berakhir'],
      ],
    },
    cube: {
      tag: '3D',
      desc: 'Terbang rendah melintasi ladang kubus tanpa ujung. Kemudikan dan bertahanlah.',
      keys: 'Panah kiri/kanan, atau tahan salah satu sisi',
      act: 'Mulai',
      ctl: [
        ['← →', 'Kemudikan'],
        ['Tahan kiri / kanan', 'Kemudikan di ponsel'],
      ],
    },
    hopper: {
      tag: '3D',
      desc: 'Lompati jalan raya dan sungai dalam 3D penuh. Berhenti bergerak, kamera akan meninggalkanmu.',
      keys: 'Atas atau Spasi untuk maju, panah kiri/kanan ke samping',
      act: 'Lompat',
      ctl: [
        ['↑ / Spasi', 'Lompat maju'],
        ['← →', 'Melangkah ke samping'],
        ['Ketuk tengah / sisi', 'Lompat di ponsel'],
        ['Kayu', 'Naiki untuk menyeberang'],
      ],
    },
    blaster: {
      tag: 'Shooter',
      desc: 'Gelombang perampok, bos setiap gelombang kelima, dan power-up yang bisa ditumpuk. Rangkai kill untuk kombo 8x.',
      keys: 'Panah kiri/kanan atau geser untuk terbang. Tembakan otomatis',
      act: 'Mulai',
      ctl: [
        ['← → / geser', 'Terbang'],
        ['Kapsul S', 'Tembakan menyebar'],
        ['Kapsul R', 'Tembakan cepat'],
        ['Kapsul H', 'Perisai untuk satu serangan'],
      ],
    },
    breaker: {
      tag: 'Arcade',
      desc: 'Hancurkan semua bata untuk naik level. Tangkap kapsul untuk multi-bola, papan lebar, atau nyawa tambahan.',
      keys: 'Panah kiri/kanan atau geser untuk gerakkan papan',
      act: 'Mulai',
      ctl: [
        ['← → / geser', 'Gerakkan papan'],
        ['Kapsul M', 'Multi-bola'],
        ['Kapsul W', 'Papan lebar'],
        ['Kapsul S / L', 'Bola lambat / nyawa tambahan'],
      ],
    },
  } satisfies { [K in GameKey]: GameText<K> },
  missions: {
    r3: 'Mainkan 3 run ranked',
    g2: 'Mainkan 2 game berbeda',
    pb: 'Cetak rekor pribadi baru',
    d1: 'Menangkan duel atau kalahkan tantangan',
    s45: 'Bertahan 45 detik dalam satu run',
    p5: 'Selesaikan 5 run apa saja',
  } satisfies Record<MissionId, string>,
  frames: {
    none: 'Tanpa bingkai',
    mint: 'Cincin Mint',
    pink: 'Cincin Pink',
    aurora: 'Cincin Aurora',
    fire: 'Cincin Api',
  } satisfies Record<FrameKey, string>,
  /** Premium avatar names by avatar id (PREMIUM_AVATARS). */
  avatars: { 12: 'Mahkota', 13: 'Visor', 14: 'Halo', 15: 'Penyihir', 16: 'Headphone', 17: 'Astronaut' } as Record<number, string>,
  tiers: { box: 'Kotak Misteri', avatar: 'Avatar {name}', rare: 'Langka', chips: '{n} tChips' },
  nameErrors: {
    length: 'Nama terdiri dari 3 sampai 16 karakter.',
    chars: 'Gunakan hanya huruf, angka, spasi, garis bawah, titik, dan tanda hubung.',
    reserved: 'Nama tidak boleh diawali "Guest" atau "Player", atau memakai nama bot.',
  } satisfies Record<NameError, string>,
  /** Words the games flash on the stage (packages/games fx text). "Level N" is matched as a pattern. */
  fx: {
    'Boss down': 'Bos tumbang',
    'Spread shot': 'Tembakan menyebar',
    'Rapid fire': 'Tembakan cepat',
    'Shield up': 'Perisai aktif',
    'Wide paddle': 'Papan lebar',
    'Slow ball': 'Bola lambat',
    'Extra life': 'Nyawa tambahan',
    'Multi-ball': 'Multi-bola',
    level: 'Level {n}',
  } as Record<string, string>,
};

export type ContentId = typeof contentId;
