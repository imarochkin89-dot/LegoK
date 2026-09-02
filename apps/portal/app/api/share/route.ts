/* eslint-disable @typescript-eslint/no-explicit-any */
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
let schemaPromise: Promise<void> | undefined;

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
}
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken() { return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""); }
function safeFilename(value: string) { return String(value || "document").replace(/[\u0000-\u001f\u007f/\\]+/g, "_").trim().slice(0, 180) || "document"; }
function snapshotProjects(value: any) { return Array.isArray(value?.projects) ? value.projects : value?.project ? [value] : []; }

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_shares (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_value TEXT NOT NULL, pin_hash TEXT NOT NULL, expires_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, snapshot TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, view_count INTEGER NOT NULL DEFAULT 0, last_viewed_at TEXT)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS public_shares_project_idx ON public_shares (project_id, updated_at)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_share_sessions (session_hash TEXT PRIMARY KEY, share_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_share_attempts (share_id TEXT NOT NULL, visitor_key TEXT NOT NULL, window_started_at TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (share_id, visitor_key))`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_documents (project_id TEXT NOT NULL, file_id TEXT NOT NULL, object_key TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, digest TEXT NOT NULL, synced_at TEXT NOT NULL, PRIMARY KEY (project_id,file_id))`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_stage_decisions (id TEXT PRIMARY KEY, share_id TEXT NOT NULL, project_id TEXT NOT NULL, task_id TEXT NOT NULL, task_title TEXT NOT NULL, decision TEXT NOT NULL, comment TEXT NOT NULL, client_name TEXT NOT NULL, decided_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (share_id,task_id))`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS public_stage_decisions_project_idx ON public_stage_decisions (project_id, updated_at)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_feedback_threads (id TEXT PRIMARY KEY, share_id TEXT NOT NULL, project_id TEXT NOT NULL, category TEXT NOT NULL, subject TEXT NOT NULL, task_id TEXT NOT NULL DEFAULT '', task_title TEXT NOT NULL DEFAULT '', client_name TEXT NOT NULL, client_contact TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS public_feedback_threads_project_idx ON public_feedback_threads (project_id, updated_at)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS public_feedback_threads_share_idx ON public_feedback_threads (share_id, updated_at)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_feedback_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, author_type TEXT NOT NULL, author_name TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS public_feedback_messages_thread_idx ON public_feedback_messages (thread_id, created_at)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_updates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'progress', pinned INTEGER NOT NULL DEFAULT 0, published_at TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS public_updates_project_idx ON public_updates (project_id, pinned, published_at)`),
    ]);
  })();
  try { await schemaPromise; } catch (error) { schemaPromise = undefined; throw error; }
}
function state(row: any) {
  if (!row) return "missing";
  if (!Number(row.active)) return "revoked";
  if (new Date(row.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}
async function findShare(token: string) {
  if (token.length < 32 || token.length > 160) return null;
  return env.DB.prepare(`SELECT id,project_id,pin_hash,expires_at,active,snapshot,view_count FROM public_shares WHERE token_hash=?`).bind(await hash(token)).first();
}
async function validSession(shareId: string, session: string) {
  if (session.length < 32) return false;
  const row: any = await env.DB.prepare(`SELECT expires_at FROM public_share_sessions WHERE share_id=? AND session_hash=?`).bind(shareId, await hash(session)).first();
  return Boolean(row && new Date(row.expires_at).getTime() > Date.now());
}
async function visitorKey(request: Request) {
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  return hash(address.trim());
}
async function limited(shareId: string, key: string) {
  const row: any = await env.DB.prepare(`SELECT window_started_at,attempt_count FROM public_share_attempts WHERE share_id=? AND visitor_key=?`).bind(shareId, key).first();
  return Boolean(row && Date.now() - new Date(row.window_started_at).getTime() <= ATTEMPT_WINDOW_MS && Number(row.attempt_count) >= 5);
}
async function fail(shareId: string, key: string) {
  const now = new Date().toISOString();
  const row: any = await env.DB.prepare(`SELECT window_started_at FROM public_share_attempts WHERE share_id=? AND visitor_key=?`).bind(shareId, key).first();
  if (!row || Date.now() - new Date(row.window_started_at).getTime() > ATTEMPT_WINDOW_MS) await env.DB.prepare(`INSERT INTO public_share_attempts (share_id,visitor_key,window_started_at,attempt_count) VALUES (?,?,?,1) ON CONFLICT(share_id,visitor_key) DO UPDATE SET window_started_at=excluded.window_started_at,attempt_count=1`).bind(shareId, key, now).run();
  else await env.DB.prepare(`UPDATE public_share_attempts SET attempt_count=attempt_count+1 WHERE share_id=? AND visitor_key=?`).bind(shareId, key).run();
}
async function snapshotFor(share: any) {
  const stored = JSON.parse(share.snapshot);
  const projects = snapshotProjects(stored).slice(0, 20);
  const common: any = await env.DB.batch([
    env.DB.prepare(`SELECT id,project_id AS projectId,task_id AS taskId,decision,comment,client_name AS clientName,decided_at AS decidedAt FROM public_stage_decisions WHERE share_id=?`).bind(share.id),
    env.DB.prepare(`SELECT id,project_id AS projectId,category,subject,task_id AS taskId,task_title AS taskTitle,client_name AS clientName,status,created_at AS createdAt,updated_at AS updatedAt FROM public_feedback_threads WHERE share_id=? ORDER BY updated_at DESC LIMIT 200`).bind(share.id),
    env.DB.prepare(`SELECT m.id,m.thread_id AS threadId,m.author_type AS authorType,m.author_name AS authorName,m.body,m.created_at AS createdAt FROM public_feedback_messages m JOIN public_feedback_threads t ON t.id=m.thread_id WHERE t.share_id=? ORDER BY m.created_at ASC LIMIT 1000`).bind(share.id),
  ]);
  const projectResults: any = projects.length ? await env.DB.batch(projects.flatMap((item: any) => [
    env.DB.prepare(`SELECT file_id,synced_at FROM public_documents WHERE project_id=?`).bind(item.project.id),
    env.DB.prepare(`SELECT id,title,body,category,pinned,published_at AS publishedAt,created_by AS createdBy FROM public_updates WHERE project_id=? ORDER BY pinned DESC,published_at DESC LIMIT 100`).bind(item.project.id),
  ])) : [];
  const decisions = common[0]?.results || [];
  const feedback = common[1]?.results || [];
  const messages = new Map<string, any[]>();
  for (const item of common[2]?.results || []) messages.set(item.threadId, [...(messages.get(item.threadId) || []), item]);
  const enriched = projects.map((projectData: any, index: number) => {
    const projectId = projectData.project.id;
    const available = new Map((projectResults[index * 2]?.results || []).map((row: any) => [row.file_id, row.synced_at]));
    const projectDecisions = new Map(decisions.filter((row: any) => row.projectId === projectId).map((row: any) => [row.taskId, row]));
    return {
      ...projectData,
      documents: (projectData.documents || []).map((document: any) => ({ ...document, available: available.has(document.id), syncedAt: available.get(document.id) || "" })),
      tasks: (projectData.tasks || []).map((task: any) => ({ ...task, decision: projectDecisions.get(task.id) || null })),
      feedback: feedback.filter((item: any) => item.projectId === projectId).map((item: any) => ({ ...item, messages: messages.get(item.id) || [] })),
      updates: (projectResults[index * 2 + 1]?.results || []).map((item: any) => ({ ...item, pinned: Boolean(item.pinned) })),
    };
  });
  if (Array.isArray(stored.projects)) return { ...stored, projects: enriched };
  return enriched[0] || stored;
}

async function feedbackRateLimited(shareId: string) {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
  const row: any = await env.DB.prepare(`SELECT COUNT(*) AS total FROM public_feedback_messages m JOIN public_feedback_threads t ON t.id=m.thread_id WHERE t.share_id=? AND m.author_type='client' AND m.created_at>=?`).bind(shareId, since).first();
  return Number(row?.total || 0) >= 20;
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const session = url.searchParams.get("session") || "";
    const share: any = await findShare(token);
    const current = state(share);
    if (current !== "active") return json({ error: current === "expired" ? "Срок действия ссылки истёк" : "Ссылка недоступна", state: current }, current === "missing" ? 404 : 410);
    if (!(await validSession(share.id, session))) return json({ locked: true, requiresPin: true }, 401);

    const snapshot = await snapshotFor(share);
    const fileId = url.searchParams.get("fileId") || "";
    if (fileId) {
      const projectData = snapshotProjects(snapshot).find((item: any) => (item.documents || []).some((document: any) => document.id === fileId));
      if (!projectData) return json({ error: "Документ не опубликован" }, 404);
      const row: any = await env.DB.prepare(`SELECT object_key,filename,mime_type,size_bytes FROM public_documents WHERE project_id=? AND file_id=?`).bind(projectData.project.id, fileId).first();
      if (!row || !env.BUCKET) return json({ error: "Документ ещё не синхронизирован" }, 409);
      const object = await env.BUCKET.get(row.object_key);
      if (!object) return json({ error: "Содержимое документа не найдено" }, 404);
      return new Response(object.body, { headers: { "Content-Type": row.mime_type || "application/octet-stream", "Content-Length": String(row.size_bytes || object.size || 0), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename(row.filename))}`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive", ...(object.httpEtag ? { ETag: object.httpEtag } : {}) } });
    }
    return json({ share: { expiresAt: share.expires_at, viewCount: Number(share.view_count || 0) }, data: snapshot });
  } catch (error) {
    console.error("share read failed", error);
    return json({ error: "Публичная страница временно недоступна" }, 503);
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body: any = await request.json();
    const token = String(body.token || "");
    const share: any = await findShare(token);
    const current = state(share);
    if (current !== "active") return json({ error: current === "expired" ? "Срок действия ссылки истёк" : "Ссылка недоступна", state: current }, current === "missing" ? 404 : 410);

    if (body.action === "decision") {
      const session = String(body.session || "");
      if (!(await validSession(share.id, session))) return json({ error: "Сеанс истёк. Введите PIN ещё раз" }, 401);
      const snapshot = JSON.parse(share.snapshot);
      const projectId = String(body.projectId || share.project_id);
      const projectData = snapshotProjects(snapshot).find((item: any) => item?.project?.id === projectId);
      const taskId = String(body.taskId || "");
      const task = (projectData?.tasks || []).find((item: any) => item.id === taskId);
      const decision = body.decision === "approved" ? "approved" : body.decision === "changes_requested" ? "changes_requested" : "";
      const comment = String(body.comment || "").trim().slice(0, 2000);
      const clientName = String(body.clientName || "").trim().slice(0, 100);
      if (!task || !decision || !clientName) return json({ error: "Укажите имя и выберите решение" }, 400);
      if (decision === "changes_requested" && !comment) return json({ error: "Опишите необходимые изменения" }, 400);
      const now = new Date().toISOString();
      const existing: any = await env.DB.prepare(`SELECT id,decided_at FROM public_stage_decisions WHERE share_id=? AND task_id=?`).bind(share.id, taskId).first();
      await env.DB.prepare(`INSERT INTO public_stage_decisions (id,share_id,project_id,task_id,task_title,decision,comment,client_name,decided_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(share_id,task_id) DO UPDATE SET project_id=excluded.project_id,task_title=excluded.task_title,decision=excluded.decision,comment=excluded.comment,client_name=excluded.client_name,decided_at=excluded.decided_at,updated_at=excluded.updated_at`).bind(existing?.id || crypto.randomUUID(), share.id, projectId, taskId, String(task.title).slice(0, 180), decision, comment, clientName, now, now).run();
      return json({ ok: true, share: { expiresAt: share.expires_at }, data: await snapshotFor(share) });
    }

    if (body.action === "feedback_create") {
      const session = String(body.session || "");
      if (!(await validSession(share.id, session))) return json({ error: "Сеанс истёк. Введите PIN ещё раз" }, 401);
      if (await feedbackRateLimited(share.id)) return json({ error: "Слишком много сообщений. Повторите немного позже" }, 429);
      const snapshot = JSON.parse(share.snapshot);
      const projectId = String(body.projectId || share.project_id);
      const projectData = snapshotProjects(snapshot).find((item: any) => item?.project?.id === projectId);
      const category = ["general", "stage", "document"].includes(body.category) ? body.category : "general";
      const subject = String(body.subject || "").trim().slice(0, 180);
      const message = String(body.message || "").trim().slice(0, 3000);
      const clientName = String(body.clientName || "").trim().slice(0, 100);
      const clientContact = String(body.clientContact || "").trim().slice(0, 160);
      const taskId = category === "stage" ? String(body.taskId || "") : "";
      const task = taskId ? (projectData?.tasks || []).find((item: any) => item.id === taskId) : null;
      if (!clientName || subject.length < 3 || message.length < 3) return json({ error: "Укажите имя, тему и сообщение" }, 400);
      if (!projectData) return json({ error: "Проект не входит в эту публичную ссылку" }, 400);
      if (category === "stage" && !task) return json({ error: "Выберите опубликованный этап" }, 400);
      const threadId = crypto.randomUUID();
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO public_feedback_threads (id,share_id,project_id,category,subject,task_id,task_title,client_name,client_contact,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'new',?,?)`).bind(threadId, share.id, projectId, category, subject, taskId, String(task?.title || "").slice(0, 180), clientName, clientContact, now, now),
        env.DB.prepare(`INSERT INTO public_feedback_messages (id,thread_id,author_type,author_name,body,created_at) VALUES (?,?,'client',?,?,?)`).bind(crypto.randomUUID(), threadId, clientName, message, now),
      ]);
      return json({ ok: true, share: { expiresAt: share.expires_at }, data: await snapshotFor(share) }, 201);
    }

    if (body.action === "feedback_reply") {
      const session = String(body.session || "");
      if (!(await validSession(share.id, session))) return json({ error: "Сеанс истёк. Введите PIN ещё раз" }, 401);
      if (await feedbackRateLimited(share.id)) return json({ error: "Слишком много сообщений. Повторите немного позже" }, 429);
      const feedbackId = String(body.feedbackId || "");
      const message = String(body.message || "").trim().slice(0, 3000);
      const clientName = String(body.clientName || "").trim().slice(0, 100);
      if (!feedbackId || !clientName || message.length < 2) return json({ error: "Введите сообщение" }, 400);
      const thread: any = await env.DB.prepare(`SELECT id FROM public_feedback_threads WHERE id=? AND share_id=?`).bind(feedbackId, share.id).first();
      if (!thread) return json({ error: "Обращение не найдено" }, 404);
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO public_feedback_messages (id,thread_id,author_type,author_name,body,created_at) VALUES (?,?,'client',?,?,?)`).bind(crypto.randomUUID(), feedbackId, clientName, message, now),
        env.DB.prepare(`UPDATE public_feedback_threads SET status='new',updated_at=? WHERE id=?`).bind(now, feedbackId),
      ]);
      return json({ ok: true, share: { expiresAt: share.expires_at }, data: await snapshotFor(share) });
    }

    if (body.action !== "unlock") return json({ error: "Неизвестное действие" }, 400);
    const key = await visitorKey(request);
    if (await limited(share.id, key)) return json({ error: "Слишком много попыток. Повторите через 15 минут" }, 429);
    if (await hash(`${token}:${String(body.pin || "").trim()}`) !== share.pin_hash) { await fail(share.id, key); return json({ error: "Неверный PIN-код" }, 401); }
    const session = randomToken();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM public_share_attempts WHERE share_id=? AND visitor_key=?`).bind(share.id, key),
      env.DB.prepare(`INSERT INTO public_share_sessions (session_hash,share_id,expires_at,created_at) VALUES (?,?,?,?)`).bind(await hash(session), share.id, expires, now),
      env.DB.prepare(`UPDATE public_shares SET view_count=view_count+1,last_viewed_at=? WHERE id=?`).bind(now, share.id),
      env.DB.prepare(`DELETE FROM public_share_sessions WHERE expires_at<=?`).bind(now),
    ]);
    return json({ session, sessionExpires: expires, share: { expiresAt: share.expires_at }, data: await snapshotFor(share) });
  } catch (error) {
    console.error("share unlock failed", error);
    return json({ error: "Не удалось открыть публичную ссылку" }, 503);
  }
}
