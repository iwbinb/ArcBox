import { expect, test } from 'vitest';
import worker from '../workers/api/src/index';

// One runtime smoke test only. D1/R2/Queues/API integration belongs to M0-C.
test('the pinned Workers test plugin runs the compilation probe in workerd', async () => {
  expect(typeof WebSocketPair).toBe('function');
  const response = await worker.fetch(new Request('https://arcbox.invalid/api/health'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ stage: 'M0-B', paymentsEnabled: false });
});
