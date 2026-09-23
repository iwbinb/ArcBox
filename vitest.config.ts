import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    include: ['tests/runtime-smoke.test.ts'],
    reporters: ['default', 'json'],
    outputFile: 'reports/runtime-tests.json',
    testTimeout: 10_000,
  },
});
