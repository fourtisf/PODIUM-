// The prototype's avatar(id, size) SVG generator, unchanged apart from taking colours from shared.
import { AVATAR_COLORS, AVATAR_COUNT, FREE_AVATARS } from '@podium/shared';

const mix = (h: string, t: string, a: number): string => {
  const p = (x: string) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const A = p(h), B = p(t);
  return '#' + A.map((v, i) => Math.round(v + (B[i]! - v) * a).toString(16).padStart(2, '0')).join('');
};
export const lite = (h: string, a: number): string => mix(h, '#ffffff', a);
export const dark = (h: string, a: number): string => mix(h, '#000000', a);

/** Everything inside the <svg class="av" viewBox="0 0 48 48"> element. */
export function avatarInner(rawId: number): string {
  const id = ((Math.floor(rawId) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
  const c = AVATAR_COLORS[id % FREE_AVATARS]!, k = id % 4, bg = lite(c, 0.62);
  let top = '';
  if (id >= FREE_AVATARS) {
    const a = id - FREE_AVATARS;
    top = [
      `<path d="M14 15l4 6 6-8 6 8 4-6v10H14z" fill="#ffc93a"/>`,
      `<rect x="11" y="21" width="26" height="9" rx="4.5" fill="#0c0f26"/><rect x="14" y="23" width="9" height="3" rx="1.5" fill="#7dd3fc"/>`,
      `<ellipse cx="24" cy="10" rx="10" ry="3" fill="none" stroke="#ffc93a" stroke-width="2.5"/>`,
      `<path d="M12 17L24 1l12 16z" fill="#6c5cff"/><circle cx="24" cy="9" r="2" fill="#ffc93a"/>`,
      `<path d="M10 27a14 14 0 0 1 28 0" fill="none" stroke="#0c0f26" stroke-width="3"/><rect x="7" y="24" width="6" height="10" rx="3" fill="#0c0f26"/><rect x="35" y="24" width="6" height="10" rx="3" fill="#0c0f26"/>`,
      `<circle cx="24" cy="27" r="18" fill="none" stroke="#fff" stroke-width="3" opacity=".9"/>`,
    ][a]!;
  } else {
    top = [
      `<path d="M11 18l3-10 8 6zM37 18l-3-10-8 6z" fill="${c}"/>`,
      `<path d="M24 13V6" stroke="${c}" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="5" r="3" fill="${c}"/>`,
      `<circle cx="13" cy="15" r="5" fill="${c}"/><circle cx="35" cy="15" r="5" fill="${c}"/>`,
      `<path d="M20 14l4-9 4 9z" fill="${dark(c, 0.2)}"/>`,
    ][k]!;
  }
  const mouth = [
    `<path d="M20 32q4 4 8 0" fill="none" stroke="#0c0f26" stroke-width="2" stroke-linecap="round"/>`,
    `<rect x="21" y="31" width="6" height="3" rx="1.5" fill="#0c0f26"/>`,
    `<path d="M20 31h8q-4 6-8 0z" fill="#0c0f26"/>`,
  ][id % 3]!;
  return `<rect width="48" height="48" fill="${bg}"/>${id >= 12 && id !== 13 && id !== 16 ? '' : top}<circle cx="24" cy="27" r="14" fill="${c}"/><circle cx="19" cy="25" r="3" fill="#0c0f26"/><circle cx="29" cy="25" r="3" fill="#0c0f26"/><circle cx="20" cy="24" r="1" fill="#fff"/><circle cx="30" cy="24" r="1" fill="#fff"/>${mouth}${id >= 12 ? top : ''}`;
}

/** The whole avatar as an SVG string, as the prototype built it. */
export const avatarSvg = (id: number, size: number): string =>
  `<svg class="av" viewBox="0 0 48 48" width="${size}" height="${size}">${avatarInner(id)}</svg>`;
