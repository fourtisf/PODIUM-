import { defineConfig } from 'vitest/config';

// Tests run against the real local Postgres (database podium_test) and Redis (db 1).
// One file at a time: every file truncates the tables and flushes Redis before it starts.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://podium:podium@127.0.0.1:5432/podium_test',
      REDIS_URL: process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379/1',
      SESSION_SECRET: 'test-secret-test-secret-test-secret',
      PUBLIC_URL: 'http://localhost:3000',
      REQUIRE_STREAM: '0',
      RATE_LIMIT_SCALE: '1000',
      EMAIL_SMTP_URL: '',
      GOOGLE_CLIENT_ID: 'test-google-id',
      GOOGLE_CLIENT_SECRET: 'test-google-secret',
    },
  },
});
