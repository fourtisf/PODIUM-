'use client';
import { useEffect, useState } from 'react';

/** A clock that starts at the server's time (so the first paint matches) and then follows the browser. */
export function useNow(serverTime: string, everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.parse(serverTime) || 0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
