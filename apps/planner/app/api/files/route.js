import { env } from "cloudflare:workers";
import { plannerFilesProjectIndex, plannerFilesSchema } from "../../../db/schema";
import { dispatchIntegrationEvent } from "../integrations/dispatch";

export const dynamic = "force-dynamic";

const WORKSPACE_KEY = "kontur-shared-workspace-v1";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
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
  const legacyName = request.headers.get("oai-authenticated-user-name")?.trim() || "";
  const name = decodeFullName(request) || legacyName || (email ? displayNameFromEmail(email) : "Владелец");
  return { key: email ? await hashValue(email) : null, email, name: name.slice(0, 100) };
}

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    if (!env.BUCKET) throw new Error("R2 binding BUCKET is unavailable");
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
    ]);
  })();
  try { await schemaPromise; } catch (error) { schemaPromise = null; throw error; }
}

async function currentMember(actor) {
  if (!actor.key || !actor.email) return null;
  return env.DB.prepare(`SELECT member_key, email, display_name, role, status FROM planner_members WHERE workspace_key = ? AND member_key = ? AND status IN ('active', 'invited')`).bind(WORKSPACE_KEY, actor.key).first();
}

async function authorize(request, write = false) {
  const actor = await actorIdentity(request);
  if (!actor.key || !actor.email) return { error: json({ error: "Требуется вход" }, 401) };
  const member = await currentMember(actor);
  if (!member) return { error: json({ error: "Нет доступа к рабочему пространству" }, 403) };
  if (write && (!member || !["owner", "editor"].includes(member.role))) return { error: json({ error: "Недостаточно прав для изменения файлов" }, 403) };
  return { actor, member };
}

function validIdentifier(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
}

function safeFilename(value) {
  return String(value || "file").replace(/[\u0000-\u001f\u007f/\\]+/g, "_").trim().slice(0, 180) || "file";
}

function filePayload(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id || "",
    name: row.filename,
    size: Number(row.size_bytes || 0),
    type: row.mime_type,
    uploadedBy: row.uploaded_by_name,
    createdAt: row.created_at,
  };
}

async function listFiles(projectId, clientOnly = false) {
  const result = await env.DB.prepare(clientOnly ? `
    SELECT f.id, f.project_id, f.task_id, f.filename, f.size_bytes, f.mime_type, f.uploaded_by_name, f.created_at
    FROM planner_files f
    JOIN planner_portal_documents d ON d.workspace_key = f.workspace_key AND d.project_id = f.project_id AND d.file_id = f.id
    WHERE f.workspace_key = ? AND f.project_id = ?
    ORDER BY d.published_at DESC
    LIMIT 1000
  ` : `
    SELECT id, project_id, task_id, filename, size_bytes, mime_type, uploaded_by_name, created_at
    FROM planner_files
    WHERE workspace_key = ? AND project_id = ?
    ORDER BY created_at DESC
    LIMIT 1000
  `).bind(WORKSPACE_KEY, projectId).all();
  return (result.results || []).map(filePayload);
}

async function logFileEvent(type, label, member, projectId, taskId = null) {
  await env.DB.prepare(`
    INSERT INTO planner_events (user_key, event_type, project_id, task_id, label, created_at, actor_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(WORKSPACE_KEY, type, projectId, taskId, String(label).slice(0, 260), new Date().toISOString(), member.display_name).run();
}

export async function GET(request) {
  try {
    await ensureSchema();
    const authorization = await authorize(request);
    if (authorization.error) return authorization.error;
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const row = await env.DB.prepare(authorization.member?.role === "client" ? `SELECT f.object_key, f.filename, f.size_bytes, f.mime_type FROM planner_files f JOIN planner_portal_documents d ON d.workspace_key = f.workspace_key AND d.project_id = f.project_id AND d.file_id = f.id WHERE f.workspace_key = ? AND f.id = ?` : `SELECT object_key, filename, size_bytes, mime_type FROM planner_files WHERE workspace_key = ? AND id = ?`).bind(WORKSPACE_KEY, id).first();
      if (!row) return json({ error: "Файл не найден" }, 404);
      const object = await env.BUCKET.get(row.object_key);
      if (!object) return json({ error: "Содержимое файла не найдено" }, 404);
      const filename = safeFilename(row.filename);
      return new Response(object.body, {
        headers: {
          "Content-Type": row.mime_type || "application/octet-stream",
          "Content-Length": String(row.size_bytes || object.size || 0),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Cache-Control": "private, no-store",
          ...(object.httpEtag ? { ETag: object.httpEtag } : {}),
        },
      });
    }
    const projectId = url.searchParams.get("projectId");
    if (!validIdentifier(projectId)) return json({ error: "Укажите проект" }, 400);
    return json({ files: await listFiles(projectId, authorization.member?.role === "client"), canEdit: Boolean(authorization.member && ["owner", "editor"].includes(authorization.member.role)), maxFileBytes: MAX_FILE_BYTES });
  } catch (error) {
    console.error("File read failed", error?.message || String(error));
    return json({ error: "Не удалось загрузить список файлов" }, 503);
  }
}

export async function POST(request) {
  let objectKey = "";
  try {
    await ensureSchema();
    const authorization = await authorize(request, true);
    if (authorization.error) return authorization.error;
    const form = await request.formData();
    const file = form.get("file");
    const projectId = String(form.get("projectId") || "");
    const taskIdValue = String(form.get("taskId") || "");
    const taskId = taskIdValue && validIdentifier(taskIdValue) ? taskIdValue : null;
    if (!validIdentifier(projectId)) return json({ error: "Некорректный проект" }, 400);
    if (!file || typeof file.stream !== "function" || typeof file.size !== "number") return json({ error: "Выберите файл" }, 400);
    if (!file.size) return json({ error: "Пустой файл загрузить нельзя" }, 400);
    if (file.size > MAX_FILE_BYTES) return json({ error: "Файл превышает 25 МБ" }, 413);
    const id = crypto.randomUUID();
    const filename = safeFilename(file.name);
    const mimeType = String(file.type || "application/octet-stream").slice(0, 120);
    objectKey = `${WORKSPACE_KEY}/${projectId}/${id}`;
    await env.BUCKET.put(objectKey, file.stream(), {
      httpMetadata: { contentType: mimeType },
      customMetadata: { filename, projectId, taskId: taskId || "" },
    });
    const createdAt = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO planner_files (id, workspace_key, project_id, task_id, object_key, filename, size_bytes, mime_type, uploaded_by_key, uploaded_by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, WORKSPACE_KEY, projectId, taskId, objectKey, filename, file.size, mimeType, authorization.member.member_key, authorization.member.display_name, createdAt).run();
    try { await logFileEvent("file_uploaded", `Загружен файл «${filename}»`, authorization.member, projectId, taskId); }
    catch (eventError) { console.error("File event write failed", eventError?.message || String(eventError)); }
    try { await dispatchIntegrationEvent({ projectId, type: "file_uploaded", label: `Загружен файл «${filename}»`, taskId, actorName: authorization.member.display_name, createdAt }); }
    catch (integrationError) { console.error("File webhook delivery failed", integrationError?.message || String(integrationError)); }
    return json({ ok: true, file: { id, projectId, taskId: taskId || "", name: filename, size: file.size, type: mimeType, uploadedBy: authorization.member.display_name, createdAt } }, 201);
  } catch (error) {
    if (objectKey && env.BUCKET) try { await env.BUCKET.delete(objectKey); } catch { /* best effort rollback */ }
    console.error("File upload failed", error?.message || String(error));
    return json({ error: "Не удалось загрузить файл" }, 503);
  }
}

export async function DELETE(request) {
  try {
    await ensureSchema();
    const authorization = await authorize(request, true);
    if (authorization.error) return authorization.error;
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return json({ error: "Укажите файл" }, 400);
    const row = await env.DB.prepare(`SELECT object_key, filename, project_id, task_id FROM planner_files WHERE workspace_key = ? AND id = ?`).bind(WORKSPACE_KEY, id).first();
    if (!row) return json({ error: "Файл не найден" }, 404);
    await env.BUCKET.delete(row.object_key);
    await env.DB.prepare(`DELETE FROM planner_files WHERE workspace_key = ? AND id = ?`).bind(WORKSPACE_KEY, id).run();
    try { await logFileEvent("file_deleted", `Удалён файл «${row.filename}»`, authorization.member, row.project_id, row.task_id); }
    catch (eventError) { console.error("File event write failed", eventError?.message || String(eventError)); }
    try { await dispatchIntegrationEvent({ projectId: row.project_id, type: "file_deleted", label: `Удалён файл «${row.filename}»`, taskId: row.task_id, actorName: authorization.member.display_name }); }
    catch (integrationError) { console.error("File webhook delivery failed", integrationError?.message || String(integrationError)); }
    return json({ ok: true });
  } catch (error) {
    console.error("File delete failed", error?.message || String(error));
    return json({ error: "Не удалось удалить файл" }, 503);
  }
}
