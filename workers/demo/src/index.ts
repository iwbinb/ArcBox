const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(body: object, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

export default {
  async fetch(request, env) {
    if (env.APP_ENV !== "demo" || env.PAYMENTS_ENABLED !== "false") {
      console.error(JSON.stringify({ event: "demo_environment_mismatch" }));
      return json({ error: "DEMO_ENVIRONMENT_MISMATCH" }, 503);
    }
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      const asset = await env.ASSETS.fetch(
        new Request(new URL("/build.json", url)),
      );
      if (
        !asset.ok ||
        !asset.body ||
        !asset.headers.get("content-type")?.includes("application/json")
      ) {
        console.error(JSON.stringify({ event: "demo_build_manifest_missing" }));
        return json({ error: "BUILD_MANIFEST_UNAVAILABLE" }, 503);
      }
      return new Response(asset.body, { status: 200, headers: jsonHeaders });
    }
    return json({ error: "NOT_FOUND" }, 404);
  },
} satisfies ExportedHandler<Env>;
