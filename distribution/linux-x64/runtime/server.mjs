export * from "../../windows-server/runtime/server.mjs";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runServer } from "../../windows-server/runtime/server.mjs";

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runServer().catch(() => { process.exitCode = 1; });
}
