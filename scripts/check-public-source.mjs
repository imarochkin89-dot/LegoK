import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const ignored = new Set([".git", "node_modules", "dist", ".next", ".vinext", ".wrangler"]);
const textExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".json", ".jsonc", ".md", ".mjs", ".sql", ".css", ".html", ".xml", ".yml", ".yaml", ".txt", ""]);
const rules = [
  ["personal login", new RegExp("imar" + "ochkin", "i")],
  ["personal name", /Иван\s+Марочкин/i],
  ["production Sites hostname", /kontur-(?:ivan-planner|public-status)\.[^\s"']+/i],
  ["Sites project id", new RegExp("appg" + "prj_[a-z0-9]+", "i")],
  ["OpenAI app id", new RegExp("oai" + "app_[a-z0-9]+", "i")],
  ["bypass token label", /siwc_bypass_bearer_token/i],
  ["private IPv4 address", /\b10(?:\.\d{1,3}){3}\b/],
];

async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile() && textExtensions.has(extname(entry.name))) yield path;
  }
}

const violations = [];
for await (const path of files(root)) {
  if (path.endsWith("scripts/check-public-source.mjs")) continue;
  const content = await readFile(path, "utf8");
  for (const [label, pattern] of rules) {
    if (pattern.test(content)) violations.push(`${relative(root, path)}: ${label}`);
  }
}

if (violations.length) {
  console.error("Source privacy check failed:\n" + violations.map(item => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log("Source privacy check passed.");
