import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const expectedSha = process.argv[2];
assert.match(
  expectedSha ?? "",
  /^[a-f0-9]{40}$/,
  "Expected a full source SHA.",
);
const origin = "https://arcbox-web-demo.iwbinb.workers.dev";
const htmlSha256 = createHash("sha256")
  .update(readFileSync("dist/web/index.html"))
  .digest("hex");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastError = "No response";

for (let attempt = 0; attempt < 12; attempt += 1) {
  try {
    const response = await fetch(`${origin}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /application\/json/,
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    const health = await response.json();
    assert.equal(health.sourceSha, expectedSha);
    assert.equal(health.htmlSha256, htmlSha256);
    assert.equal(health.stage, "M1-C-D0");
    assert.equal(health.environment, "demo");
    assert.equal(health.paymentsEnabled, false);
    assert.equal(health.release, "final");

    const denied = await fetch(`${origin}/api/pay`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(denied.status, 404);
    assert.match(denied.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await denied.json(), { error: "NOT_FOUND" });
    console.log(
      `AUTO_DEMO_VERIFIED sourceSha=${expectedSha} paymentsEnabled=false`,
    );
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    if (attempt < 11) await pause(2_000);
  }
}
throw new Error(`PUBLIC_DEMO_VERIFICATION_FAILED: ${lastError}`);
