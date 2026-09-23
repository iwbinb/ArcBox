import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// All bindings exist only in the local test runtime. No remote resource IDs.
export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './probes/runtime/wrangler.jsonc' },
    miniflare: {
      bindings: { PROBE_MODE: 'local-test', SCHEDULE_SCOPE: 'scheduled-probe' },
      d1Databases: ['DB'],
      r2Buckets: ['FILES'],
      queueProducers: { JOBS: 'm0c-jobs' },
      queueConsumers: {
        'm0c-jobs': { maxBatchSize: 1, maxBatchTimeout: 0.1, maxRetries: 2, deadLetterQueue: 'm0c-dead' },
        'm0c-dead': { maxBatchSize: 1, maxBatchTimeout: 0.1 },
      },
    },
  })],
  test: {
    include: ['tests/runtime/bindings.test.ts'],
    reporters: ['default', 'json'],
    outputFile: 'reports/bindings-tests.json',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
