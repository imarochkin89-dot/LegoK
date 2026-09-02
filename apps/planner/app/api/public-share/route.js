import { env } from "cloudflare:workers";
import { plannerFilesProjectIndex, plannerFilesSchema } from "../../../db/schema";

export const dynamic = "force-dynamic";
const WORKSPACE_KEY = "kontur-shared-workspace-v1";
let schemaPromise;

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}
async function hashValue(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function validIdentifier(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value); }
function decodeFullName(request) {
  const encoded = request.headers.get("oai-authenticated-user-full-name")?.trim();
  if (!encoded || request.headers.get("oai-authenticated-user-full-name-encoding") !== "percent-encoded-utf-8") return "";
  try { return decodeURIComponent(encoded); } catch { return ""; }
}
function displayNameFromEmail(email) { return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\p{L}/gu, letter => letter.toUpperCase()); }
async function actorIdentity(request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "";
  const name = decodeFullName(request) || request.headers.get("oai-authenticated-user-name")?.trim() || (email ? displayNameFromEmail(email) : "");
  return { key: email ? await hashValue(email) : null, email, name: name.slice(0, 100) };
}
async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    await env.DB.batch([
      env.DB.prepare(plannerFilesSchema),
      env.DB.prepare(plannerFilesProjectIndex),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS planner_portal_documents (workspace_key TEXT NOT NULL, project_id TEXT NOT NULL, file_id TEXT NOT NULL, published_at TEXT NOT NULL, published_by TEXT NOT NULL, PRIMARY KEY (workspace_key, project_id, file_id))`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS planner_public_decisions (id TEXT PRIMARY KEY, workspace_key TEXT NOT NULL, project_id TEXT NOT NULL, share_id TEXT NOT NULL, task_id TEXT NOT NULL, task_title TEXT NOT NULL, decision TEXT NOT NULL, comment TEXT NOT NULL, client_name TEXT NOT NULL, decided_at TEXT NOT NULL, updated_at TEXT NOT NULL, imported_at TEXT NOT NULL)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS planner_public_decisions_project_idx ON planner_public_decisions (workspace_key,project_id,updated_at)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS planner_public_feedback_imports (message_id TEXT PRIMARY KEY, workspace_key TEXT NOT NULL, project_id TEXT NOT NULL, feedback_id TEXT NOT NULL, task_id TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, client_name TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, imported_at TEXT NOT NULL)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS planner_public_feedback_imports_project_idx ON planner_public_feedback_imports (workspace_key,project_id,created_at)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS planner_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_key TEXT NOT NULL, event_type TEXT NOT NULL, project_id TEXT, task_id TEXT, label TEXT NOT NULL, created_at TEXT NOT NULL, actor_name TEXT)`),
    ]);
  })();
  try { await schemaPromise; } catch (error) { schemaPromise = null; throw error; }
}
async function requireManager(request) {
  const actor = await actorIdentity(request);
  if (!actor.key || !actor.email) return { error: json({ error: "Требуется вход" }, 401) };
  const member = await env.DB.prepare(`SELECT member_key, display_name, role FROM planner_members WHERE workspace_key = ? AND member_key = ? AND status = 'active'`).bind(WORKSPACE_KEY, actor.key).first();
  if (!member || !["owner", "editor"].includes(member.role)) return { error: json({ error: "Недостаточно прав" }, 403) };
  return { actor, member };
}
function progressOf(task) {
  if (task.subtasks?.length) return Math.round((task.subtasks.filter(item => item.done).length / task.subtasks.length) * 100);
  return Math.min(100, Math.max(0, Number(task.progress) || 0));
}
async function buildSnapshot(projectId) {
  const row = await env.DB.prepare(`SELECT data FROM planner_workspace_state WHERE workspace_key = ?`).bind(WORKSPACE_KEY).first();
  const state = row?.data ? JSON.parse(row.data) : null;
  const projects = Array.isArray(state?.projects) ? state.projects.slice(0, 30) : [];
  if (!projects.some(item => item.id === projectId)) return null;
  const fileResults = projects.length ? await env.DB.batch(projects.map(project => env.DB.prepare(`SELECT f.id, f.filename AS name, f.size_bytes AS size, f.mime_type AS type, d.published_at AS publishedAt FROM planner_portal_documents d JOIN planner_files f ON f.id = d.file_id AND f.workspace_key = d.workspace_key WHERE d.workspace_key = ? AND d.project_id = ? ORDER BY d.published_at DESC`).bind(WORKSPACE_KEY, project.id))) : [];
  const generatedAt = new Date().toISOString();
  return {
    version: 2,
    anchorProjectId: projectId,
    projects: projects.map((project, index) => {
      const portal = project.clientPortal && typeof project.clientPortal === "object" ? project.clientPortal : {};
      const publishedTaskIds = new Set(Array.isArray(portal.publishedTaskIds) ? portal.publishedTaskIds : []);
      return {
        project: { id: project.id, name: project.name, description: project.description || "", color: project.color || "#2f7754" },
        portal: { clientName: portal.clientName || "Клиентский портал", greeting: portal.greeting || "Актуальный статус проекта и согласованные материалы.", contactName: portal.contactName || "Руководитель проекта", contactEmail: portal.contactEmail || "", nextUpdate: portal.nextUpdate || "" },
        tasks: (project.tasks || []).filter(task => publishedTaskIds.has(task.id)).map(task => ({ id: task.id, title: task.title, description: task.description || "", status: task.status, due: task.due || "", progress: progressOf(task) })),
        documents: (fileResults[index]?.results || []).map(file => ({ ...file, projectId: project.id })),
        generatedAt,
      };
    }),
    generatedAt,
  };
}
function snapshotProjects(snapshot) { return Array.isArray(snapshot?.projects) ? snapshot.projects : snapshot?.project ? [snapshot] : []; }
function publicOrigin() {
  const origin = String(env.PUBLIC_SHARE_ORIGIN || "").replace(/\/$/, "");
  if (!/^https:\/\//.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    throw new Error("PUBLIC_SHARE_ORIGIN is unavailable");
  }
  return origin;
}
async function signManage(payload) {
  const secret = String(env.PUBLIC_SHARE_SECRET || "");
  if (secret.length < 32) throw new Error("PUBLIC_SHARE_SECRET is unavailable");
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${nonce}.${body}`));
  const signature = Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, "0")).join("");
  return { origin: publicOrigin(), bridge: { endpoint: `${publicOrigin()}/api/manage`, body, timestamp, nonce, signature } };
}

export async function GET(request) {
  try {
    await ensureSchema();
    const authorization = await requireManager(request);
    if (authorization.error) return authorization.error;
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!validIdentifier(projectId)) return json({ error: "Укажите проект" }, 400);
    const snapshot = await buildSnapshot(projectId);
    if (!snapshot) return json({ error: "Проект не найден" }, 404);
    return json(await signManage({ action: "list", projectId, snapshot }));
  } catch (error) {
    console.error("Public share list failed", error?.message || String(error));
    return json({ error: "Публичный портал временно недоступен" }, 503);
  }
}

export async function POST(request) {
  try {
    await ensureSchema();
    const authorization = await requireManager(request);
    if (authorization.error) return authorization.error;
    const body = await request.json();
    const projectId = String(body.projectId || "");
    if (!validIdentifier(projectId)) return json({ error: "Некорректный проект" }, 400);
    if (body.action === "import_decisions") {
      const decisions = Array.isArray(body.decisions) ? body.decisions.slice(0, 300) : [];
      let imported = 0;
      for (const item of decisions) {
        const id = String(item.id || "");
        const taskId = String(item.taskId || "");
        const decision = item.decision === "approved" ? "approved" : item.decision === "changes_requested" ? "changes_requested" : "";
        if (!validIdentifier(id) || !validIdentifier(taskId) || !decision) continue;
        const updatedAt = String(item.updatedAt || item.decidedAt || "");
        const targetProjectId = validIdentifier(String(item.projectId || "")) ? String(item.projectId) : projectId;
        const existing = await env.DB.prepare(`SELECT updated_at FROM planner_public_decisions WHERE id=? AND workspace_key=?`).bind(id, WORKSPACE_KEY).first();
        if (existing?.updated_at === updatedAt) continue;
        const taskTitle = String(item.taskTitle || "Этап").slice(0, 180);
        const clientName = String(item.clientName || "Клиент").slice(0, 100);
        const comment = String(item.comment || "").slice(0, 2000);
        const decidedAt = String(item.decidedAt || new Date().toISOString());
        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO planner_public_decisions (id,workspace_key,project_id,share_id,task_id,task_title,decision,comment,client_name,decided_at,updated_at,imported_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,task_title=excluded.task_title,decision=excluded.decision,comment=excluded.comment,client_name=excluded.client_name,decided_at=excluded.decided_at,updated_at=excluded.updated_at,imported_at=excluded.imported_at`).bind(id, WORKSPACE_KEY, targetProjectId, String(item.shareId || "").slice(0, 120), taskId, taskTitle, decision, comment, clientName, decidedAt, updatedAt, now),
          env.DB.prepare(`INSERT INTO planner_events (user_key,event_type,project_id,task_id,label,created_at,actor_name) VALUES (?,?,?,?,?,?,?)`).bind(WORKSPACE_KEY, decision === "approved" ? "public_stage_approved" : "public_stage_changes_requested", targetProjectId, taskId, decision === "approved" ? `Клиент согласовал этап «${taskTitle}»` : `Клиент запросил изменения этапа «${taskTitle}»`, decidedAt, clientName),
        ]);
        imported += 1;
      }
      return json({ ok: true, imported });
    }
    if (body.action === "import_feedback") {
      const feedback = Array.isArray(body.feedback) ? body.feedback.slice(0, 200) : [];
      let imported = 0;
      for (const thread of feedback) {
        const feedbackId = String(thread.id || "");
        if (!validIdentifier(feedbackId)) continue;
        const subject = String(thread.subject || "Обращение клиента").slice(0, 180);
        const targetProjectId = validIdentifier(String(thread.projectId || "")) ? String(thread.projectId) : projectId;
        const taskId = validIdentifier(String(thread.taskId || "")) ? String(thread.taskId) : "";
        for (const item of Array.isArray(thread.messages) ? thread.messages.slice(0, 100) : []) {
          if (item.authorType !== "client") continue;
          const messageId = String(item.id || "");
          if (!validIdentifier(messageId)) continue;
          const existing = await env.DB.prepare(`SELECT message_id FROM planner_public_feedback_imports WHERE message_id=? AND workspace_key=?`).bind(messageId, WORKSPACE_KEY).first();
          if (existing) continue;
          const clientName = String(item.authorName || thread.clientName || "Клиент").slice(0, 100);
          const message = String(item.body || "").trim().slice(0, 3000);
          const createdAt = String(item.createdAt || thread.createdAt || new Date().toISOString());
          const now = new Date().toISOString();
          await env.DB.batch([
            env.DB.prepare(`INSERT INTO planner_public_feedback_imports (message_id,workspace_key,project_id,feedback_id,task_id,subject,client_name,message,created_at,imported_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(messageId, WORKSPACE_KEY, targetProjectId, feedbackId, taskId, subject, clientName, message, createdAt, now),
            env.DB.prepare(`INSERT INTO planner_events (user_key,event_type,project_id,task_id,label,created_at,actor_name) VALUES (?,?,?,?,?,?,?)`).bind(WORKSPACE_KEY, "public_feedback_received", targetProjectId, taskId || null, `Новое сообщение клиента: «${subject}»`, createdAt, clientName),
          ]);
          imported += 1;
        }
      }
      return json({ ok: true, imported });
    }
    const snapshot = await buildSnapshot(projectId);
    if (!snapshot) return json({ error: "Проект не найден" }, 404);
    if (body.action === "prepare_file_upload") {
      const fileId = String(body.fileId || "");
      const digest = String(body.digest || "");
      const document = snapshotProjects(snapshot).flatMap(item => item.documents || []).find(item => item.id === fileId);
      if (!document || !/^[a-f0-9]{64}$/.test(digest)) return json({ error: "Документ не опубликован" }, 400);
      if (Number(body.size) !== Number(document.size) || Number(document.size) > 25 * 1024 * 1024) return json({ error: "Размер документа не совпадает" }, 400);
      return json(await signManage({ action: "prepare_file_upload", projectId: document.projectId || projectId, file: { id: document.id, name: document.name, type: document.type, size: document.size, digest } }));
    }
    return json(await signManage({ action: body.action, projectId, projectIds: Array.isArray(body.projectIds) ? body.projectIds : undefined, shareId: body.shareId, days: body.days, pin: body.pin, feedbackId: body.feedbackId, message: body.message, status: body.status, updateId: body.updateId, title: body.title, content: body.content, category: body.category, pinned: Boolean(body.pinned), snapshot, createdBy: authorization.member.display_name }));
  } catch (error) {
    console.error("Public share write failed", error?.message || String(error));
    return json({ error: "Не удалось обновить публичную ссылку" }, 503);
  }
}
