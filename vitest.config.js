import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      MONGO_URL: 'set-by-mongodb-memory-server',
      JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      // Tests run a fake website on localhost.
      ALLOW_PRIVATE_TARGETS: 'true',
      // Fast timings so retry/backoff tests take milliseconds, not minutes.
      JOBS_PROCESS_EVERY_MS: '100',
      CHECK_RETRIES: '2',
      CHECK_RETRY_BASE_MS: '20',
      ALERT_RETRY_BASE_MS: '50',
      ALERT_MAX_RETRIES: '3',
    },
    hookTimeout: 120_000, // first run downloads a MongoDB binary
    testTimeout: 20_000,
  },
});
