import { mkdir, copyFile, readdir } from "node:fs/promises";

await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await mkdir("dist/.openai/drizzle", { recursive: true });
for (const filename of await readdir("db/migrations")) {
  if (filename.endsWith(".sql")) await copyFile(`db/migrations/${filename}`, `dist/.openai/drizzle/${filename}`);
}
