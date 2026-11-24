// Server component: wraps a page so its client components get that page's Indonesian dictionaries.
// English pages render the children unchanged; nothing is added to the page data.
import { LangExtend, type IdAreas } from './client';
import { idAreas } from './server';

export function IdArea({ areas, children }: { areas: (keyof IdAreas)[]; children: React.ReactNode }) {
  const id = idAreas(areas);
  return id ? <LangExtend id={id}>{children}</LangExtend> : <>{children}</>;
}
