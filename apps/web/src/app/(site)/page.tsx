import { HomeScreen } from '@/components/HomeScreen';

export default function HomePage({ searchParams }: { searchParams: { c?: string | string[] } }) {
  const c = Array.isArray(searchParams.c) ? searchParams.c[0] : searchParams.c;
  return <HomeScreen challengeCode={c} />;
}
