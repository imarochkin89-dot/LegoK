import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, appendFile, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  authenticateBasic,
  loadConfig,
  publicOrigin,
  trustedIdentityHeaders,
} from "./config-tool.mjs";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const TRUSTED_HEADER_PREFIX = "oai-authenticated-user-";
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_FAILURES = 10;

export function sanitizeForwardHeaders(headers, user, remoteAddress) {
  const next = {};
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = rawName.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(name) ||
      name === "authorization" ||
      name === "cf-connecting-ip" ||
      name.startsWith("x-forwarded-") ||
      name.startsWith(TRUSTED_HEADER_PREFIX)
    ) continue;
    if (rawValue != null) next[name] = rawValue;
  }
  const clientAddress = String(remoteAddress || "").replace(/^::ffff:/, "") || "127.0.0.1";
  next["x-forwarded-for"] = clientAddress;
  next["x-forwarded-proto"] = "https";
  next["cf-connecting-ip"] = clientAddress;
  if (user) Object.assign(next, trustedIdentityHeaders(user));
  return next;
}

export function createLocalWranglerConfig(base, options) {
  const config = {
    ...base,
    name: options.name,
    vars: { ...(base.vars || {}), ...options.vars },
    d1_databases: [{
      binding: "DB",
      database_name: options.databaseName,
      database_id: options.databaseId,
    }],
    r2_buckets: [{ binding: "BUCKET", bucket_name: options.bucketName }],
    dev: {
      ...(base.dev || {}),
      ip: "127.0.0.1",
      local_protocol: "http",
      upstream_protocol: "http",
    },
  };
  delete config.legacy_env;
  return config;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function safeHost(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.startsWith("[")) return text.slice(1, text.indexOf("]"));
  return text.split(":")[0].replace(/\.$/, "");
}

function requestIp(request) {
  return String(request.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

function securityHeaders(headers = {}) {
  return {
    ...headers,
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

function sendText(response, status, body, headers = {}) {
  response.writeHead(status, securityHeaders({
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  }));
  response.end(body);
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function locateWrangler(appRoot) {
  const candidates = [
    join(appRoot, "distribution", "windows-server", "runtime-package", "node_modules", "wrangler", "bin", "wrangler.js"),
    join(appRoot, "apps", "planner", "node_modules", "wrangler", "bin", "wrangler.js"),
    join(appRoot, "apps", "portal", "node_modules", "wrangler", "bin", "wrangler.js"),
  ];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error("Wrangler не найден. Переустановите пакет или выполните npm run setup.");
}

async function writeWorkerConfigs(config) {
  const plannerServer = join(config.paths.app, "apps", "planner", "dist", "server");
  const portalServer = join(config.paths.app, "apps", "portal", "dist", "server");
  const plannerBase = JSON.parse(await readFile(join(plannerServer, "wrangler.json"), "utf8"));
  const portalBase = JSON.parse(await readFile(join(portalServer, "wrangler.json"), "utf8"));
  const plannerPath = join(plannerServer, "wrangler.local.json");
  const portalPath = join(portalServer, "wrangler.local.json");
  const planner = createLocalWranglerConfig(plannerBase, {
    name: "kontur-local-planner",
    databaseName: "kontur-local-planner",
    databaseId: "11111111-1111-4111-8111-111111111111",
    bucketName: "kontur-local-planner-files",
    vars: {
      PUBLIC_SHARE_ORIGIN: publicOrigin(config.network.portalHost, config.network.httpsPort),
      PUBLIC_SHARE_SECRET: config.secrets.shareSecret,
    },
  });
  const portal = createLocalWranglerConfig(portalBase, {
    name: "kontur-local-portal",
    databaseName: "kontur-local-portal",
    databaseId: "22222222-2222-4222-8222-222222222222",
    bucketName: "kontur-local-portal-files",
    vars: {
      PLANNER_ORIGIN: publicOrigin(config.network.plannerHost, config.network.httpsPort),
      PUBLISH_SECRET: config.secrets.shareSecret,
    },
  });
  await writeFile(plannerPath, `${JSON.stringify(planner, null, 2)}\n`, "utf8");
  await writeFile(portalPath, `${JSON.stringify(portal, null, 2)}\n`, "utf8");
  return { plannerPath, portalPath };
}

async function waitForWorker(name, port, child, log) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`${name} завершился с кодом ${child.exitCode}. Проверьте журнал.`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) {
        await log(`${name} готов на внутреннем порту ${port}.`);
        return;
      }
    } catch { /* worker is still starting */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`${name} не запустился за 120 секунд.`);
}

function filterResponseHeaders(headers) {
  const next = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value != null) next[name] = value;
  }
  return securityHeaders(next);
}

function proxy(request, response, port, user) {
  const headers = sanitizeForwardHeaders(request.headers, user, requestIp(request));
  const upstream = http.request({
    hostname: "127.0.0.1",
    port,
    method: request.method,
    path: request.url,
    headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, filterResponseHeaders(upstreamResponse.headers));
    upstreamResponse.pipe(response);
  });
  upstream.setTimeout(120_000, () => upstream.destroy(new Error("upstream timeout")));
  upstream.on("error", (error) => {
    if (!response.headersSent) sendText(response, 502, "Локальный сервис временно недоступен.");
    else response.destroy(error);
  });
  request.on("aborted", () => upstream.destroy());
  request.pipe(upstream);
}

function authLimiter() {
  const failures = new Map();
  return {
    blocked(ip) {
      const current = failures.get(ip);
      if (!current) return false;
      if (Date.now() - current.startedAt > AUTH_WINDOW_MS) { failures.delete(ip); return false; }
      return current.count >= AUTH_MAX_FAILURES;
    },
    fail(ip) {
      const current = failures.get(ip);
      if (!current || Date.now() - current.startedAt > AUTH_WINDOW_MS) failures.set(ip, { count: 1, startedAt: Date.now() });
      else current.count += 1;
    },
    success(ip) { failures.delete(ip); },
  };
}

async function acquirePidFile(path) {
  await mkdir(dirname(path), { recursive: true });
  if (await exists(path)) {
    try {
      const previous = JSON.parse(await readFile(path, "utf8"));
      process.kill(Number(previous.pid), 0);
      throw new Error(`Контур уже запущен (PID ${previous.pid}).`);
    } catch (error) {
      if (String(error.message || "").startsWith("Контур уже запущен")) throw error;
      await rm(path, { force: true });
    }
  }
  const handle = await open(path, "wx", 0o600);
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  await handle.close();
}

async function main() {
  const configPath = resolve(option("--config"));
  if (!option("--config")) throw new Error("Укажите --config <путь>.");
  const config = await loadConfig(configPath);
  await Promise.all([
    mkdir(config.paths.data, { recursive: true }),
    mkdir(config.paths.logs, { recursive: true }),
    mkdir(dirname(config.paths.pidFile), { recursive: true }),
  ]);
  await acquirePidFile(config.paths.pidFile);
  const logPath = join(config.paths.logs, "kontur-runtime.log");
  const workerLog = createWriteStream(join(config.paths.logs, "workers.log"), { flags: "a" });
  const log = async (message) => {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    process.stdout.write(line);
    await appendFile(logPath, line, "utf8");
  };
  const children = [];
  let gateway;
  let redirectServer;
  let stopping = false;

  const shutdown = async (reason, exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    await log(`Остановка: ${reason}`).catch(() => {});
    await Promise.all([
      new Promise((done) => gateway?.close(done) || done()),
      new Promise((done) => redirectServer?.close(done) || done()),
    ]);
    for (const child of children) if (child.exitCode == null) child.kill("SIGTERM");
    await rm(config.paths.pidFile, { force: true }).catch(() => {});
    workerLog.end();
    process.exitCode = exitCode;
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (error) => {
    void log(`Необработанная ошибка: ${error.stack || error.message}`).finally(() => shutdown("ошибка", 1));
  });
  process.on("unhandledRejection", (error) => {
    void log(`Необработанное отклонение: ${error?.stack || error}`).finally(() => shutdown("ошибка", 1));
  });

  try {
    const wrangler = await locateWrangler(config.paths.app);
    const { plannerPath, portalPath } = await writeWorkerConfigs(config);
    const definitions = [
      { name: "Планировщик", port: config.network.plannerWorkerPort, configPath: plannerPath, state: join(config.paths.data, "planner") },
      { name: "Публичный портал", port: config.network.portalWorkerPort, configPath: portalPath, state: join(config.paths.data, "portal") },
    ];
    for (const definition of definitions) {
      await mkdir(definition.state, { recursive: true });
      const child = spawn(process.execPath, [
        wrangler,
        "dev",
        "--config", definition.configPath,
        "--local",
        "--ip", "127.0.0.1",
        "--port", String(definition.port),
        "--persist-to", definition.state,
        "--show-interactive-dev-session=false",
      ], {
        cwd: dirname(definition.configPath),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, WRANGLER_WRITE_LOGS: "false", MINIFLARE_REGISTRY_PATH: join(definition.state, "registry") },
      });
      child.stdout.pipe(workerLog, { end: false });
      child.stderr.pipe(workerLog, { end: false });
      children.push(child);
    }
    await Promise.all(definitions.map((definition, index) => waitForWorker(definition.name, definition.port, children[index], log)));

    const pfx = await readFile(config.paths.tlsPfx);
    const limiter = authLimiter();
    gateway = https.createServer({ pfx, passphrase: config.tls.pfxPassword }, (request, response) => {
      const host = safeHost(request.headers.host);
      if (host === config.network.plannerHost) {
        const ip = requestIp(request);
        if (limiter.blocked(ip)) {
          sendText(response, 429, "Слишком много попыток входа. Повторите через 15 минут.", { "retry-after": "900" });
          return;
        }
        const user = authenticateBasic(request.headers.authorization, config.users);
        if (!user) {
          limiter.fail(ip);
          sendText(response, 401, "Введите email и пароль локального пользователя.", {
            "www-authenticate": 'Basic realm="Kontur Planner", charset="UTF-8"',
          });
          return;
        }
        limiter.success(ip);
        proxy(request, response, config.network.plannerWorkerPort, user);
        return;
      }
      if (host === config.network.portalHost) {
        proxy(request, response, config.network.portalWorkerPort, null);
        return;
      }
      sendText(response, 421, "Неизвестное имя сервера.");
    });
    gateway.requestTimeout = 125_000;
    gateway.headersTimeout = 130_000;
    await new Promise((resolvePromise, reject) => {
      gateway.once("error", reject);
      gateway.listen(config.network.httpsPort, config.network.bindAddress, resolvePromise);
    });

    redirectServer = http.createServer((request, response) => {
      const host = safeHost(request.headers.host);
      if (![config.network.plannerHost, config.network.portalHost].includes(host)) {
        sendText(response, 421, "Неизвестное имя сервера.");
        return;
      }
      response.writeHead(308, { location: `${publicOrigin(host, config.network.httpsPort)}${request.url || "/"}`, "cache-control": "no-store" });
      response.end();
    });
    await new Promise((resolvePromise, reject) => {
      redirectServer.once("error", reject);
      redirectServer.listen(config.network.httpPort, config.network.bindAddress, resolvePromise);
    });

    await writeFile(config.paths.pidFile, `${JSON.stringify({
      pid: process.pid,
      workers: children.map((child) => child.pid),
      startedAt: new Date().toISOString(),
    })}\n`, { mode: 0o600 });
    await log(`Контур запущен: ${publicOrigin(config.network.plannerHost, config.network.httpsPort)}`);
  } catch (error) {
    await log(`Ошибка запуска: ${error.stack || error.message}`).catch(() => {});
    await shutdown("ошибка запуска", 1);
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { process.exitCode = 1; });
}
