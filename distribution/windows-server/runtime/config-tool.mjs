import { pbkdf2Sync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CONFIG_VERSION = 1;
export const PASSWORD_ITERATIONS = 310_000;

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%*-_";

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Укажите корректный email пользователя.");
  }
  return email;
}

export function validateHost(value) {
  const host = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (
    host.length < 1 ||
    host.length > 253 ||
    !host.includes(".") ||
    !host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new Error(`Некорректное DNS-имя: ${value}`);
  }
  return host;
}

export function parsePort(value, fallback) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Некорректный TCP-порт: ${value}`);
  }
  return port;
}

export function validateIPv4Network(value) {
  const text = String(value || "").trim();
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d|[12]\d|3[0-2])$/.exec(text);
  if (!match || match.slice(1, 5).some((octet) => Number(octet) > 255)) {
    throw new Error(`Некорректная IPv4-подсеть: ${value}`);
  }
  return text;
}

export function generatePassword(length = 24) {
  if (!Number.isInteger(length) || length < 16) throw new Error("Пароль должен содержать не менее 16 символов.");
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join("");
}

export function createPasswordRecord(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 512) {
    throw new Error("Пароль должен содержать от 12 до 512 символов.");
  }
  const salt = randomBytes(24);
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256");
  return {
    algorithm: "pbkdf2-sha256",
    iterations: PASSWORD_ITERATIONS,
    salt: salt.toString("base64url"),
    hash: hash.toString("base64url"),
  };
}

export function verifyPassword(password, record) {
  try {
    if (record?.algorithm !== "pbkdf2-sha256") return false;
    const iterations = Number(record.iterations);
    if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
    const salt = Buffer.from(record.salt, "base64url");
    const expected = Buffer.from(record.hash, "base64url");
    if (salt.length < 16 || expected.length !== 32) return false;
    const actual = pbkdf2Sync(String(password || ""), salt, iterations, expected.length, "sha256");
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function parseBasicAuthorization(value) {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(String(value || "").trim());
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return { email: decoded.slice(0, separator).trim().toLowerCase(), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export function authenticateBasic(value, users) {
  const credentials = parseBasicAuthorization(value);
  const list = Array.isArray(users) ? users : [];
  const user = credentials ? list.find((item) => item.email === credentials.email && item.enabled !== false) : null;
  const fallback = list[0]?.password;
  const record = user?.password || fallback || createPasswordRecord(generatePassword());
  const valid = verifyPassword(credentials?.password || "", record);
  return valid && user ? user : null;
}

export function trustedIdentityHeaders(user) {
  return {
    "oai-authenticated-user-email": user.email,
    "oai-authenticated-user-name": user.displayName,
    "oai-authenticated-user-full-name": encodeURIComponent(user.displayName),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

export function publicOrigin(host, port = 443) {
  return `https://${host}${Number(port) === 443 ? "" : `:${port}`}`;
}

export async function loadConfig(configPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config.version !== CONFIG_VERSION) throw new Error("Неподдерживаемая версия конфигурации.");
  if (!config.network || !config.paths || !config.tls || !config.secrets) throw new Error("Конфигурация повреждена.");
  config.network.plannerHost = validateHost(config.network.plannerHost);
  config.network.portalHost = validateHost(config.network.portalHost);
  for (const key of ["httpPort", "httpsPort", "plannerWorkerPort", "portalWorkerPort"]) {
    config.network[key] = parsePort(config.network[key]);
  }
  config.network.allowedNetworks = Array.isArray(config.network.allowedNetworks)
    ? config.network.allowedNetworks.map(validateIPv4Network)
    : [];
  if (config.network.plannerHost === config.network.portalHost) {
    throw new Error("Планировщик и портал должны использовать разные DNS-имена.");
  }
  if (String(config.secrets.shareSecret || "").length < 32) throw new Error("Секрет связи приложений слишком короткий.");
  if (!config.paths.app || !config.paths.data || !config.paths.logs || !config.paths.tlsPfx || !config.paths.pidFile) {
    throw new Error("В конфигурации отсутствуют системные пути.");
  }
  if (!Array.isArray(config.users) || config.users.length < 1) throw new Error("В конфигурации нет локальных пользователей.");
  for (const user of config.users || []) {
    user.email = normalizeEmail(user.email);
    if (!user.displayName) throw new Error(`Не задано имя пользователя ${user.email}.`);
  }
  return config;
}

async function writeConfig(configPath, config) {
  await mkdir(dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, configPath);
  try { await chmod(configPath, 0o600); } catch { /* Windows ACL is applied by the installer. */ }
}

function env(name, fallback = "") {
  const value = process.env[name];
  return value == null || value === "" ? fallback : value;
}

function envPath(name, fallback) {
  return resolve(env(name, fallback));
}

function createInitialConfig() {
  const rawInstallRoot = env("KONTUR_INSTALL_ROOT");
  if (!rawInstallRoot) throw new Error("Не задан KONTUR_INSTALL_ROOT.");
  const installRoot = resolve(rawInstallRoot);
  const adminEmail = normalizeEmail(env("KONTUR_ADMIN_EMAIL", "admin@kontur.local"));
  const adminName = env("KONTUR_ADMIN_NAME", "Администратор").trim().slice(0, 100) || "Администратор";
  const adminPassword = env("KONTUR_ADMIN_PASSWORD") || generatePassword();
  const httpsPort = parsePort(env("KONTUR_HTTPS_PORT"), 443);
  const config = {
    version: CONFIG_VERSION,
    createdAt: new Date().toISOString(),
    network: {
      bindAddress: env("KONTUR_BIND_ADDRESS", "0.0.0.0"),
      plannerHost: validateHost(env("KONTUR_PLANNER_HOST", "planner.kontur.local")),
      portalHost: validateHost(env("KONTUR_PORTAL_HOST", "portal.kontur.local")),
      httpPort: parsePort(env("KONTUR_HTTP_PORT"), 80),
      httpsPort,
      plannerWorkerPort: parsePort(env("KONTUR_PLANNER_WORKER_PORT"), 14173),
      portalWorkerPort: parsePort(env("KONTUR_PORTAL_WORKER_PORT"), 14174),
      allowedNetworks: env("KONTUR_ALLOWED_NETWORKS")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map(validateIPv4Network),
    },
    paths: {
      installRoot,
      app: envPath("KONTUR_APP_ROOT", join(installRoot, "app")),
      data: envPath("KONTUR_DATA_ROOT", join(installRoot, "data")),
      logs: envPath("KONTUR_LOG_ROOT", join(installRoot, "logs")),
      tlsPfx: envPath("KONTUR_TLS_PFX", join(installRoot, "tls", "gateway.pfx")),
      pidFile: envPath("KONTUR_PID_FILE", join(installRoot, "run", "kontur.pid.json")),
      runtimeConfig: envPath("KONTUR_RUNTIME_CONFIG_ROOT", join(installRoot, "run")),
    },
    tls: { pfxPassword: env("KONTUR_PFX_PASSWORD") || randomBytes(32).toString("base64url") },
    secrets: { shareSecret: env("KONTUR_SHARE_SECRET") || randomBytes(48).toString("base64url") },
    users: [{
      email: adminEmail,
      displayName: adminName,
      enabled: true,
      createdAt: new Date().toISOString(),
      password: createPasswordRecord(adminPassword),
    }],
  };
  if (config.network.plannerHost === config.network.portalHost) {
    throw new Error("Планировщик и портал должны использовать разные DNS-имена.");
  }
  return { config, credentials: { email: adminEmail, password: adminPassword } };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function commandCreate(configPath) {
  const { config, credentials } = createInitialConfig();
  await writeConfig(configPath, config);
  process.stdout.write(`${JSON.stringify(credentials)}\n`);
}

async function commandAddUser(configPath) {
  const config = await loadConfig(configPath);
  const email = normalizeEmail(option("--email") || env("KONTUR_USER_EMAIL"));
  const displayName = String(option("--name") || env("KONTUR_USER_NAME") || email.split("@")[0]).trim().slice(0, 100);
  const password = env("KONTUR_USER_PASSWORD") || generatePassword();
  const current = config.users.find((item) => item.email === email);
  const record = {
    email,
    displayName,
    enabled: true,
    createdAt: current?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    password: createPasswordRecord(password),
  };
  config.users = current ? config.users.map((item) => item.email === email ? record : item) : [...config.users, record];
  await writeConfig(configPath, config);
  process.stdout.write(`${JSON.stringify({ email, displayName, password })}\n`);
}

async function commandRemoveUser(configPath) {
  const config = await loadConfig(configPath);
  const email = normalizeEmail(option("--email") || env("KONTUR_USER_EMAIL"));
  if (!config.users.some((item) => item.email === email)) throw new Error("Пользователь не найден.");
  if (config.users.filter((item) => item.enabled !== false).length <= 1) {
    throw new Error("Нельзя удалить последнего активного пользователя.");
  }
  config.users = config.users.filter((item) => item.email !== email);
  await writeConfig(configPath, config);
  process.stdout.write(`${JSON.stringify({ removed: email })}\n`);
}

async function commandListUsers(configPath) {
  const config = await loadConfig(configPath);
  process.stdout.write(`${JSON.stringify(config.users.map(({ email, displayName, enabled }) => ({ email, displayName, enabled })), null, 2)}\n`);
}

async function commandSetNetworks(configPath) {
  const config = await loadConfig(configPath);
  const raw = option("--networks") || env("KONTUR_ALLOWED_NETWORKS");
  const networks = String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(validateIPv4Network);
  if (networks.length < 1) throw new Error("Укажите хотя бы одну разрешённую IPv4-подсеть.");
  config.network.allowedNetworks = networks;
  await writeConfig(configPath, config);
  process.stdout.write(`${JSON.stringify({ allowedNetworks: networks })}\n`);
}

export async function runConfigTool() {
  const [command] = process.argv.slice(2);
  const configPath = resolve(option("--config") || env("KONTUR_CONFIG_PATH"));
  if (!command || !configPath) {
    throw new Error("Использование: config-tool.mjs <create|add-user|remove-user|list-users|set-networks> --config <путь>");
  }
  if (command === "create") await commandCreate(configPath);
  else if (command === "add-user") await commandAddUser(configPath);
  else if (command === "remove-user") await commandRemoveUser(configPath);
  else if (command === "list-users") await commandListUsers(configPath);
  else if (command === "set-networks") await commandSetNetworks(configPath);
  else throw new Error(`Неизвестная команда: ${command}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runConfigTool().catch((error) => {
    process.stderr.write(`Ошибка: ${error.message}\n`);
    process.exitCode = 1;
  });
}
