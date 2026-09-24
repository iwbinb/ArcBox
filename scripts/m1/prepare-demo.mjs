import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const release = process.env.ARCBOX_DEMO_RELEASE ?? "final";
assert.ok(
  ["baseline", "final"].includes(release),
  "Unknown demo release label",
);
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
assert.match(sourceSha, /^[a-f0-9]{40}$/);
assert.ok(
  existsSync("dist/web/index.html"),
  "Build the Vite site before preparing demo",
);
const htmlSha256 = createHash("sha256")
  .update(readFileSync("dist/web/index.html"))
  .digest("hex");
const manifest = {
  schemaVersion: 1,
  status: "ok",
  stage: "M1-C-D0",
  environment: "demo",
  paymentsEnabled: false,
  sourceSha,
  release,
  htmlSha256,
};
writeFileSync("dist/web/build.json", JSON.stringify(manifest) + "\n");
console.log(`DEMO_BUILD ${JSON.stringify(manifest)}`);
