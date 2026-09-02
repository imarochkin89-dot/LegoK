import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";

test("builds the worker and keeps preview metadata", async () => {
  const worker = await stat(new URL("../dist/server/index.js", import.meta.url));
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.ok(worker.size > 0);
  assert.match(layout, /["']codex-preview["']\s*:\s*["']development["']/);
});
