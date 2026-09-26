import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins:[cloudflareTest({wrangler:{configPath:'./probes/identity/wrangler.jsonc'},miniflare:{d1Databases:['DB'],bindings:{APP_ENV:'local',APP_ORIGIN:'https://identity.test',CHAIN_ID:'5042002',AUTH_ENABLED:'true',RPC_URL:'https://rpc.testnet.arc.io'}}})],
  test:{include:['tests/identity/**/*.test.ts'],reporters:['default','json'],outputFile:'reports/identity-tests.json',testTimeout:15000,hookTimeout:20000},
});
