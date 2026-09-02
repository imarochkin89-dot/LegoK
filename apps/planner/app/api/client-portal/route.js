import { env } from "cloudflare:workers";
import { plannerFilesProjectIndex, plannerFilesSchema } from "../../../db/schema";

export const dynamic = "force-dynamic";

const WORKSPACE_KEY = "kontur-shared-workspace-v1";
let schemaPromise;

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

async function hashValue(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function displayNameFromEmail(email) {
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function decodeFullName(request) {
  const encoded = request.headers.get("oai-authenticated-user-full-name")?.trim();
  if (!encoded || request.headers.get("oai-authenticated-user-full-name-encoding") !== "percent-encoded-utf-8") return "";
  try { return decodeURIComponent(encoded); } catch { return ""; }
}

async function actorIdentity(request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "";
  const name = decodeFullName(request) || request.headers.get("oai-authenticated-user-name")?.trim() || (email ? displayNameFromEmail(email) : "Владелец");
  return { key: email ? await hashValue(email) : null, email, name: name.slice(0, 100) };
}

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    await env.DB.batch([
      env.DB.prepare(plannerFilesSchema),
      env.DB.prepare(plannerFilesProjectIndex),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS planner_portal_documents (
          workspace_key TEXT NOT NULL,
          project_id TEXT NOT NULL,
          file_id TEXT NOT NULL,
          published_at TEXT NOT NULL,
          published_by TEXT NOT NULL,
          PRIMARY KEY (workspace_key, project_id, file_id)
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS planner_client_requests (
          id TEXT PRIMARY KEY,
          workspace_key TEXT NOT NULL,
          project_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          status TEXT NOT NULL,
          response TEXT,
          created_by_key TEXT NOT NULL,
          created_by_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS planner_client_requests_project_idx ON planner_client_requests (workspace_key, project_id, updated_at)`),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS planner_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_key TEXT NOT NULL,
          event_type TEXT NOT NULL,
          project_id TEXT,
          task_id TEXT,
          label TEXT NOT NULL,
          created_at TEXT NOT NULL,
          actor_name TEXT
        )
      `),
    ]);
  })();
  try { await schemaPromise; } catch (error) { schemaPromise = null; throw error; }
}

async function authorize(request) {
  const actor = await actorIdentity(request);
  if (!actor.key || !actor.email) return { error: json({ error: "Требуется вход" }, 401) };
  const member = await env.DB.prepare(`SELECT member_key, email, display_name, role, status FROM planner_members WHERE workspace_key = ? AND member_key = ? AND status IN ('active', 'invited')`).bind(WORKSPACE_KEY, actor.key).first();
  if (!member) return { error: json({ error: "Нет доступа к клиентскому порталу" }, 403) };
  return { actor, member };
}

function validIdentifier(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
}

async function logEvent(type, label, projectId, member, createdAt) {
  await env.DB.prepare(`INSERT INTO planner_events (user_key, event_type, project_id, task_id, label, created_at, actor_name) VALUES (?, ?, ?, NULL, ?, ?, ?)`).bind(WORKSPACE_KEY, type, projectId, String(label).slice(0, 260), createdAt, member.display_name).run();
}

async function portalPayload(projectId, member) {
  const canManage = Boolean(member && ["owner", "editor"].includes(member.role));
  const [requestsResult, publishedResult] = await env.DB.batch([
    env.DB.prepare(`SELECT id, kind, title, body, status, response, created_by_name AS createdBy, created_at AS createdAt, updated_at AS updatedAt FROM planner_client_requests WHERE workspace_key = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 200`).bind(WORKSPACE_KEY, projectId),
    env.DB.prepare(`SELECT f.id, f.filename AS name, f.size_bytes AS size, f.mime_type AS type, f.uploaded_by_name AS uploadedBy, f.created_at AS createdAt, d.published_at AS publishedAt FROM planner_portal_documents d JOIN planner_files f ON f.id = d.file_id AND f.workspace_key = d.workspace_key WHERE d.workspace_key = ? AND d.project_id = ? ORDER BY d.published_at DESC`).bind(WORKSPACE_KEY, projectId),
  ]);
  let availableFiles = [];
  if (canManage) {
    const allFiles = await env.DB.prepare(`SELECT id, filename AS name, size_bytes AS size, mime_type AS type, uploaded_by_name AS uploadedBy, created_at AS createdAt FROM planner_files WHERE workspace_key = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1000`).bind(WORKSPACE_KEY, projectId).all();
    availableFiles = allFiles.results || [];
  }
  return { requests: requestsResult.results || [], documents: publishedResult.results || [], availableFiles, canManage };
}

export async function GET(request) {
  try {
    await ensureSchema();
    const authorization = await authorize(request);
    if (authorization.error) return authorization.error;
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!validIdentifier(projectId)) return json({ error: "Укажите проект" }, 400);
    return json(await portalPayload(projectId, authorization.member));
  } catch (error) {
    console.error("Client portal read failed", error?.message || String(error));
    return json({ error: "Не удалось загрузить клиентский портал" }, 503);
  }
}

export async function POST(request) {
  try {
    await ensureSchema();
    const authorization = await authorize(request);
    if (authorization.error || !authorization.member) return authorization.error || json({ error: "Требуется вход" }, 403);
    const body = await request.json();
    const projectId = String(body.projectId || "");
    if (!validIdentifier(projectId)) return json({ error: "Некорректный проект" }, 400);
    const member = authorization.member;
    const canManage = ["owner", "editor"].includes(member.role);
    const now = new Date().toISOString();

    if (body.action === "create_request") {
      const kind = body.kind === "approval" && canManage ? "approval" : "question";
      const title = String(body.title || "").trim().slice(0, 140);
      const text = String(body.body || "").trim().slice(0, 3000);
      if (!title || !text) return json({ error: "Заполните тему и сообщение" }, 400);
      await env.DB.prepare(`INSERT INTO planner_client_requests (id, workspace_key, project_id, kind, title, body, status, response, created_by_key, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', '', ?, ?, ?, ?)`).bind(crypto.randomUUID(), WORKSPACE_KEY, projectId, kind, title, text, member.member_key, member.display_name, now, now).run();
      await logEvent(kind === "approval" ? "client_approval_created" : "client_question_created", kind === "approval" ? `Отправлено клиенту согласование «${title}»` : `Добавлено клиентское обращение «${title}»`, projectId, member, now);
    } else if (body.action === "update_request") {
      const requestId = String(body.requestId || "");
      const status = ["open", "approved", "changes", "closed"].includes(body.status) ? body.status : "open";
      const response = String(body.response || "").trim().slice(0, 3000);
      const current = await env.DB.prepare(`SELECT kind FROM planner_client_requests WHERE workspace_key = ? AND project_id = ? AND id = ?`).bind(WORKSPACE_KEY, projectId, requestId).first();
      if (!current) return json({ error: "Обращение не найдено" }, 404);
      if (!canManage && !(member.role === "client" && current.kind === "approval" && ["approved", "changes"].includes(status))) return json({ error: "Недостаточно прав" }, 403);
      await env.DB.prepare(`UPDATE planner_client_requests SET status = ?, response = ?, updated_at = ? WHERE workspace_key = ? AND project_id = ? AND id = ?`).bind(status, response, now, WORKSPACE_KEY, projectId, requestId).run();
      await logEvent(current.kind === "approval" ? "client_approval_updated" : "client_question_updated", current.kind === "approval" ? `Клиентское согласование: ${status}` : `Обращение клиента: ${status}`, projectId, member, now);
    } else if (body.action === "toggle_document") {
      if (!canManage) return json({ error: "Недостаточно прав" }, 403);
      const fileId = String(body.fileId || "");
      if (!fileId) return json({ error: "Файл не выбран" }, 400);
      if (body.published) await env.DB.prepare(`INSERT INTO planner_portal_documents (workspace_key, project_id, file_id, published_at, published_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_key, project_id, file_id) DO UPDATE SET published_at = excluded.published_at, published_by = excluded.published_by`).bind(WORKSPACE_KEY, projectId, fileId, now, member.display_name).run();
      else await env.DB.prepare(`DELETE FROM planner_portal_documents WHERE workspace_key = ? AND project_id = ? AND file_id = ?`).bind(WORKSPACE_KEY, projectId, fileId).run();
      await logEvent(body.published ? "client_document_published" : "client_document_hidden", body.published ? "Документ опубликован в клиентском портале" : "Документ скрыт из клиентского портала", projectId, member, now);
    } else return json({ error: "Неизвестное действие" }, 400);

    return json({ ok: true, ...(await portalPayload(projectId, member)) });
  } catch (error) {
    console.error("Client portal write failed", error?.message || String(error));
    return json({ error: "Не удалось обновить клиентский портал" }, 503);
  }
}
