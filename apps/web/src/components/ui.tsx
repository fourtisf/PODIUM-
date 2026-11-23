// Small presentational pieces lifted from the prototype's markup. No hooks: usable on the server too.
import { GAMES, type GameKey } from '@podium/shared';
import { avatarInner } from '@/lib/avatar';
import { frameCss } from '@/lib/format';

export function Avatar({ id, size }: { id: number; size: number }) {
  return <svg className="av" viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" dangerouslySetInnerHTML={{ __html: avatarInner(id) }} />;
}

/** An avatar inside its profile frame (the prototype's myAv). */
export function FramedAvatar({ id, frame, size }: { id: number; frame: string; size: number }) {
  return (
    <span className="avw" style={{ background: frameCss(frame) }}>
      <Avatar id={id} size={size} />
    </span>
  );
}

/** Static cover art. Goes inside a `.cover` container (or the in-game `.bg`). */
export function Cover({ game, eager }: { game: GameKey; eager?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/covers/${game}.svg`}
      alt={`${GAMES[game].name} cover art`}
      width={640}
      height={400}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      {...(eager ? { fetchPriority: 'high' as const } : {})}
    />
  );
}

export function BoxSvg({ size }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" {...(size ? { width: size, height: size } : {})} aria-hidden="true">
      <rect x="6" y="18" width="36" height="24" rx="5" fill="#8f83ff" />
      <rect x="4" y="12" width="40" height="10" rx="4" fill="#a79bff" />
      <rect x="21" y="12" width="6" height="30" fill="#ffc93a" />
      <path d="M24 12q-10-10-12-2t12 2q10-10 12-2t-12 2" fill="none" stroke="#ffc93a" strokeWidth="3" />
    </svg>
  );
}

export function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#ff3d77" />
      <rect x="6.5" y="17" width="5.6" height="8.5" rx="1.4" fill="#fff" />
      <rect x="13.2" y="9" width="5.6" height="16.5" rx="1.4" fill="#fff" />
      <rect x="19.9" y="14" width="5.6" height="11.5" rx="1.4" fill="#fff" />
    </svg>
  );
}

export function FrameSwatch({ css, size, style }: { css: string; size?: number; style?: React.CSSProperties }) {
  return (
    <div className="fr" style={{ background: css, ...(size ? { width: size, height: size } : {}), ...style }}>
      <i />
    </div>
  );
}
