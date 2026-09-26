import { readFileSync } from 'node:fs';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins:[cloudflareTest({
    wrangler:{configPath:'./probes/identity/wrangler.jsonc'},
    miniflare:{
      d1Databases:['DB'],
      bindings:{
        APP_ENV:'local',APP_ORIGIN:'https://identity.test',CHAIN_ID:'5042002',
        AUTH_ENABLED:'true',RPC_URL:'https://rpc.testnet.arc.io',
        ORDERS_ENABLED:'true',ORDER_SYNC_ENABLED:'false',
        ORDER_EVM_CAPTURE:readFileSync('reports/order-evm-capture.json','utf8'),
      },
    },
  })],
  test:{include:['tests/orders/**/*.test.ts'],reporters:['default','json'],outputFile:'reports/orders-tests.json',testTimeout:20000,hookTimeout:20000},
});
