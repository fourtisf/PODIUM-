// Operator tools. Not linked from the site and kept out of search (robots.ts, noindex). The API
// alone decides who may use it; the page shows "Not available" to everyone else.
import type { Metadata } from 'next';
import { AdminView } from '@/components/AdminView';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

export default function AdminPage() {
  return <AdminView />;
}
