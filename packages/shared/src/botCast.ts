// The ten bot characters that stand on the benchmark ladder (BOT_LADDER in bots.ts), weakest first.
// They are DISPLAY ONLY: the web app shows them, always with a "BOT" chip, under thin boards. They are not
// players and never take a place, a prize or any server-side effect. Names are robot names on purpose, so no
// row can pass for a person. Bolt, the site's robot mascot, is the strongest.
export interface BotChar {
  /** 1 (weakest) .. 10 (strongest); BOT_LADDER[game][level - 1] is its score. */
  level: number;
  name: string;
  /** One of the site's avatar ids (0..17), distinct per bot; shown with a robot badge. */
  avatar: number;
}

export const BOT_CAST: readonly BotChar[] = [
  { level: 1, name: 'Ziggy', avatar: 8 },
  { level: 2, name: 'Byte', avatar: 4 },
  { level: 3, name: 'Widget', avatar: 2 },
  { level: 4, name: 'Pixel', avatar: 7 },
  { level: 5, name: 'Gizmo', avatar: 1 },
  { level: 6, name: 'Rivet', avatar: 5 },
  { level: 7, name: 'Sprocket', avatar: 6 },
  { level: 8, name: 'Cogsworth', avatar: 10 },
  { level: 9, name: 'Turbo', avatar: 3 },
  { level: 10, name: 'Bolt', avatar: 9 },
];
