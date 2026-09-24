import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createTestHarness } from "wrangler";

const config = JSON.parse(readFileSync("wrangler.demo.jsonc", "utf8"));
const build = JSON.parse(readFileSync("dist/web/build.json", "utf8"));
const server = createTestHarness({
  workers: [
    {
      config: {
        ...config,
        main: resolve("dist/demo/index.js"),
        no_bundle: true,
        assets: { ...config.assets, directory: resolve("dist/web") },
      },
    },
  ],
});
const navigation = {
  headers: { accept: "text/html", "sec-fetch-mode": "navigate" },
};
before(
  async () => {
    await server.listen();
  },
  { timeout: 30_000 },
);
after(async () => {
  await server.close();
});

test("D0-01 health reports the built source and disabled payments", async () => {
  const response = await server.fetch("/api/health");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), build);
  assert.equal(build.stage, "M1-C-D0");
  assert.equal(build.environment, "demo");
  assert.equal(build.paymentsEnabled, false);
  assert.match(build.sourceSha, /^[a-f0-9]{40}$/);
});

test("D0-02 unknown or write API routes remain JSON 404", async () => {
  for (const [path, init] of [
    ["/api", navigation],
    ["/api/missing", navigation],
    ["/api/pay", { method: "POST" }],
    ["/api/health", { method: "POST" }],
  ]) {
    const response = await server.fetch(path, init);
    assert.equal(response.status, 404, path);
    assert.match(
      response.headers.get("content-type") ?? "",
      /application\/json/,
      path,
    );
    assert.equal(response.headers.get("cache-control"), "no-store", path);
    assert.deepEqual(await response.json(), { error: "NOT_FOUND" }, path);
  }
});

test("D0-03 direct tool navigation serves the SPA without exposing an API", async () => {
  const response = await server.fetch("/tools/group", navigation);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await response.text(), /ArcBox/);
});

test("D0-04 static JS matches the built artifact and is immutable", async () => {
  const html = readFileSync("dist/web/index.html", "utf8");
  const path = /src="(\/assets\/[^"\s]+\.js)"/.exec(html)?.[1];
  assert.ok(path);
  const response = await server.fetch(path);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /javascript/);
  assert.match(response.headers.get("cache-control") ?? "", /immutable/);
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    digest(Buffer.from(await response.arrayBuffer())),
    digest(readFileSync(`dist/web${path}`)),
  );
});

test("D0-05 public assets decline indexing and apply basic security headers", async () => {
  const response = await server.fetch("/", navigation);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /script-src 'self'/,
  );
  const buildResponse = await server.fetch("/build.json");
  assert.equal(buildResponse.status, 200);
  assert.equal(buildResponse.headers.get("cache-control"), "no-store");
});

test("D0-06 deployment only binds static assets and demo literals", () => {
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.vars, { APP_ENV: "demo", PAYMENTS_ENABLED: "false" });
  for (const key of [
    "account_id",
    "routes",
    "d1_databases",
    "r2_buckets",
    "queues",
    "triggers",
    "secrets",
    "kv_namespaces",
  ]) {
    assert.equal(config[key], undefined, key);
  }
});
