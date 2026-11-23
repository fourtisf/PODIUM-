// Open Graph image for a challenge link (1200 x 630), mirroring the browser-drawn share card:
// cover on the left, brand mark, game name, big score, player name, "Can you beat this score?".
// Lives outside /api because Nginx sends /api to Fastify.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND, GAMES, fmt, isGameKey } from '@podium/shared';
import type { ChallengeResponse, GameKey } from '@podium/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API = (process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

async function coverData(game: GameKey): Promise<string | null> {
  try {
    const svg = await readFile(path.join(process.cwd(), 'public', 'covers', `${game}.svg`));
    return `data:image/svg+xml;base64,${svg.toString('base64')}`;
  } catch {
    return null;
  }
}

async function challenge(code: string): Promise<ChallengeResponse | null> {
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(code)) return null;
  try {
    const res = await fetch(`${API}/api/challenges/${code}`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const c = (await res.json()) as ChallengeResponse;
    return isGameKey(c.game) ? c : null;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const c = await challenge(params.code);
  const game: GameKey = c?.game ?? 'hopper';
  const cover = await coverData(game);
  const ink = '#0c0f26';
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: 'flex', background: '#ffffff', fontFamily: 'sans-serif' }}>
        <div style={{ width: 660, height: 630, display: 'flex', background: ink, overflow: 'hidden' }}>
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={cover} width={1008} height={630} style={{ marginLeft: -174 }} />
          )}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '56px 50px 26px 50px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: '#ff3d77', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 8 }}>
              <div style={{ width: 8, height: 12, background: '#fff', marginRight: 1 }} />
              <div style={{ width: 8, height: 24, background: '#fff', marginRight: 1 }} />
              <div style={{ width: 8, height: 16, background: '#fff' }} />
            </div>
            <div style={{ marginLeft: 14, fontSize: 30, fontWeight: 800, color: ink }}>{BRAND.name}</div>
          </div>
          {c ? (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 70 }}>
              <div style={{ fontSize: 26, fontWeight: 600, color: '#555b76' }}>{GAMES[game].name}</div>
              <div style={{ fontSize: fmt(c.score).length > 6 ? 104 : 150, fontWeight: 800, color: ink, lineHeight: 1.1, letterSpacing: -4 }}>{fmt(c.score)}</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: '#0a9a69' }}>Score to beat</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 90 }}>
              <div style={{ fontSize: 54, fontWeight: 800, color: ink, lineHeight: 1.1 }}>{BRAND.line}</div>
              <div style={{ fontSize: 26, fontWeight: 600, color: '#555b76', marginTop: 18 }}>Played with tChips: test chips with no value.</div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
            {c && <div style={{ fontSize: 28, fontWeight: 700, color: ink, marginBottom: 22 }}>{c.name}</div>}
            <div style={{ display: 'flex', alignItems: 'center', height: 44, borderRadius: 22, background: ink, color: '#fff', fontSize: 20, fontWeight: 700, paddingLeft: 24 }}>
              {c ? 'Can you beat this score?' : `Play on ${BRAND.name}`}
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'cache-control': 'public, max-age=300' } },
  );
}
