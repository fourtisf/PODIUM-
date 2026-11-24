// Shared bits of /terms and /privacy (server components, no client code).
import { contactEmail } from '@podium/shared';

/** Date shown under the heading of both legal pages. Change it whenever either page changes. */
export const LEGAL_UPDATED = '24 November 2026';
export const LEGAL_UPDATED_ISO = '2026-11-24';

/** The contact address from CONTACT_EMAIL / NEXT_PUBLIC_CONTACT_EMAIL, or a placeholder until it is set. */
export function Contact() {
  const e = contactEmail();
  return e ? <a href={`mailto:${e}`}>{e}</a> : <span>[contact email]</span>;
}

export function Updated() {
  return (
    <p className="legalDate">
      Last updated <time dateTime={LEGAL_UPDATED_ISO}>{LEGAL_UPDATED}</time>
    </p>
  );
}
