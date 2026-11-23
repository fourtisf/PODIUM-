// Browser-safe. Every instruction logs one or more lines "podium:<event> key=value ...".
export interface PodiumLog {
  event: string;
  fields: Record<string, string>;
}

const PREFIX = 'Program log: podium:';

/** Extracts the program's reconciliation lines from a transaction's log messages. */
export function parsePodiumLogs(logs: readonly string[]): PodiumLog[] {
  const out: PodiumLog[] = [];
  for (const line of logs) {
    if (!line.startsWith(PREFIX)) continue;
    const [event, ...pairs] = line.slice(PREFIX.length).split(' ');
    if (!event) continue;
    const fields: Record<string, string> = {};
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq > 0) fields[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    out.push({ event, fields });
  }
  return out;
}
