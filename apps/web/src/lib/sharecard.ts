// The share card, drawn on a canvas in the browser exactly as the prototype does (1200 x 630).
import { BRAND, fmt } from '@podium/shared';

export interface ShareCardData {
  gameKey: string;
  gameName: string;
  score: number;
  /** Line under the score: "Place 2 this week", "Duel won", "Practice run". */
  line: string;
  playerName: string;
  level: number;
}

const DISP = '"Bricolage Grotesque Variable","Bricolage Grotesque",system-ui';
const BODY = '"Instrument Sans Variable","Instrument Sans",system-ui';

function rr(x: CanvasRenderingContext2D, a: number, b: number, w: number, h: number, r: number): void {
  x.beginPath();
  if (typeof x.roundRect === 'function') x.roundRect(a, b, w, h, r);
  else x.rect(a, b, w, h);
  x.fill();
}

export function paintShareCard(c: HTMLCanvasElement, d: ShareCardData, img: CanvasImageSource | null, mark: CanvasImageSource | null = null): void {
  c.width = 1200;
  c.height = 630;
  const x = c.getContext('2d');
  if (!x) return;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 1200, 630);
  if (img) {
    const s = Math.max(660 / 640, 630 / 400), w = 640 * s, h = 400 * s;
    x.save();
    x.beginPath();
    x.rect(0, 0, 660, 630);
    x.clip();
    x.drawImage(img, (660 - w) / 2, (630 - h) / 2, w, h);
    x.restore();
  } else {
    x.fillStyle = '#0c0f26';
    x.fillRect(0, 0, 660, 630);
  }
  if (mark) {
    x.drawImage(mark, 710, 56, 44, 44);
  } else {
    x.fillStyle = '#ff8fc0';
    rr(x, 710, 56, 44, 44, 11);
  }
  x.fillStyle = '#0c0f26';
  x.font = `800 30px ${DISP}`;
  x.textBaseline = 'middle';
  x.fillText(BRAND.name, 768, 79);
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#555b76';
  x.font = `600 26px ${BODY}`;
  x.fillText(d.gameName, 710, 196);
  x.fillStyle = '#0c0f26';
  x.font = `800 150px ${DISP}`;
  x.fillText(fmt(d.score), 704, 340);
  x.fillStyle = '#0a9a69';
  x.font = `700 30px ${BODY}`;
  x.fillText(d.line, 710, 398);
  x.fillStyle = '#0c0f26';
  x.font = `700 28px ${BODY}`;
  x.fillText(d.playerName, 710, 500);
  x.fillStyle = '#8f95ad';
  x.font = `600 22px ${BODY}`;
  x.fillText('Level ' + d.level, 710, 534);
  x.fillStyle = '#0c0f26';
  rr(x, 710, 560, 430, 44, 22);
  x.fillStyle = '#fff';
  x.font = `700 20px ${BODY}`;
  x.fillText('Can you beat this score?', 734, 589);
}

/** Draws the card with the game's static cover and returns a PNG data URL (null when the browser blocks it). */
export async function renderShareCard(d: ShareCardData): Promise<string | null> {
  const c = document.createElement('canvas');
  try {
    await Promise.all([document.fonts.load(`800 150px ${DISP}`), document.fonts.load(`700 30px ${BODY}`)]);
  } catch {
    /* fall back to system fonts */
  }
  const load = (src: string, w: number, h: number) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const im = new Image();
      im.width = w;
      im.height = h;
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = src;
    });
  const [img, mark] = await Promise.all([load(`/covers/${d.gameKey}.svg`, 640, 400), load('/icon.svg', 64, 64)]);
  try {
    paintShareCard(c, d, img, mark);
    return c.toDataURL('image/png');
  } catch {
    try {
      paintShareCard(c, d, null, null);
      return c.toDataURL('image/png');
    } catch {
      return null;
    }
  }
}
