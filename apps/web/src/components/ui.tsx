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

/** The brand mark: Bolt the robot on a rounded tile. Same drawing as /public/icon.svg. */
export function Mark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#ff8fc0"/><g transform="translate(1 4.5) scale(.31)"><path d="M100 40V20" stroke="#0c0f26" strokeWidth="7" strokeLinecap="round"/><path d="M100 14l24 8-24 8z" fill="#ff3d77" stroke="#0c0f26" strokeWidth="5" strokeLinejoin="round"/><g stroke="#0c0f26" strokeWidth="7" strokeLinejoin="round"><rect x="26" y="88" width="20" height="44" rx="8" fill="#a79bff"/><rect x="154" y="88" width="20" height="44" rx="8" fill="#a79bff"/><rect x="40" y="40" width="120" height="124" rx="38" fill="#e9edff"/><rect x="54" y="74" width="92" height="46" rx="23" fill="#0c0f26"/></g><path d="M72 98l10-8 10 8M108 98l10-8 10 8" fill="none" stroke="#7af0c5" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/><path d="M76 140q24 14 48 0" fill="none" stroke="#0c0f26" strokeWidth="6" strokeLinecap="round"/><circle cx="62" cy="138" r="7" fill="#ff8fc0"/><circle cx="138" cy="138" r="7" fill="#ff8fc0"/><path d="M60 56q20-10 40-10" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round"/></g></svg>
  );
}

export function FrameSwatch({ css, size, style }: { css: string; size?: number; style?: React.CSSProperties }) {
  return (
    <div className="fr" style={{ background: css, ...(size ? { width: size, height: size } : {}), ...style }}>
      <i />
    </div>
  );
}
