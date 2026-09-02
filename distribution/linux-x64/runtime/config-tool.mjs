export * from "../../windows-server/runtime/config-tool.mjs";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runConfigTool } from "../../windows-server/runtime/config-tool.mjs";

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runConfigTool().catch((error) => {
    process.stderr.write(`Ошибка: ${error.message}\n`);
    process.exitCode = 1;
  });
}
