/** Compilation probe only: no persistence, wallet, signing or payment endpoints. */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ stage: 'M0-B', paymentsEnabled: false }), { headers });
    }
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404, headers });
  },
} satisfies ExportedHandler;
