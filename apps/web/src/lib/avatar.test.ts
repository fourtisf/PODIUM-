import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS } from '@podium/shared';
import { avatarInner, avatarSvg, dark, lite } from './avatar';

describe('avatar generator', () => {
  it('mixes colours like the prototype', () => {
    expect(lite('#000000', 0.5)).toBe('#808080');
    expect(dark('#ffffff', 1)).toBe('#000000');
    expect(lite('#ff4f81', 0)).toBe('#ff4f81');
  });

  it('wraps the art in an svg of the asked size', () => {
    const s = avatarSvg(3, 46);
    expect(s.startsWith('<svg class="av" viewBox="0 0 48 48" width="46" height="46">')).toBe(true);
    expect(s.endsWith('</svg>')).toBe(true);
  });

  it('is deterministic and uses the base colour of the id', () => {
    for (let id = 0; id < 18; id++) {
      expect(avatarInner(id)).toBe(avatarInner(id));
      expect(avatarInner(id)).toContain(`<circle cx="24" cy="27" r="14" fill="${AVATAR_COLORS[id % 12]}"/>`);
    }
  });

  it('wraps ids past the last avatar and tolerates hashes', () => {
    expect(avatarInner(18)).toBe(avatarInner(0));
    expect(avatarInner(4294967295)).toBe(avatarInner(4294967295 % 18));
    expect(avatarInner(-1)).toBe(avatarInner(17));
  });

  it('draws premium headgear over the face and free ears behind it', () => {
    const crown = avatarInner(12);
    expect(crown.indexOf('#ffc93a')).toBeGreaterThan(crown.indexOf('r="14"'));
    const free = avatarInner(0);
    expect(free.indexOf('M11 18l3-10')).toBeLessThan(free.indexOf('r="14"'));
    // Visor (13) and headphones (16) are drawn both behind and over, as in the prototype.
    expect(avatarInner(13).split('rx="4.5"').length).toBe(3);
  });
});
