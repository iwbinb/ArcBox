import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './probes/identity/wrangler.jsonc' },
    miniflare: {
      bindings: { APP_ENV:'local', APP_ORIGIN:'https://identity.test', CHAIN_ID:'5042002', AUTH_ENABLED:'true', RPC_URL:'https://rpc.testnet.arc.io', ORDERS_ENABLED:'true', ORDER_SYNC_ENABLED:'false', PLATFORM_ENABLED:'true' },
      d1Databases:['DB'], r2Buckets:['FILES'],
      queueProducers:{JOBS:'arcbox-platform-local'},
      queueConsumers:{
        'arcbox-platform-local':{maxBatchSize:1,maxBatchTimeout:0.1,maxRetries:1,deadLetterQueue:'arcbox-platform-dead-local'},
        'arcbox-platform-dead-local':{maxBatchSize:1,maxBatchTimeout:0.1,maxRetries:3},
      },
    },
  })],
  test:{include:['tests/platform/**/*.test.ts'],reporters:['default','json'],outputFile:'reports/platform-tests.json',testTimeout:20000,hookTimeout:20000},
});
