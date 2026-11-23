import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Applies the committed migrations to the test database once per test run. */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL || 'postgresql://podium:podium@127.0.0.1:5432/podium_test';
  execSync('pnpm exec prisma migrate deploy', {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
