/* eslint-disable @typescript-eslint/no-explicit-any */
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
const SIGNATURE_TTL_MS = 90_000;
let schemaPromise: Promise<void> | undefined;

function plannerOrigin() {
  const origin = String(env.PLANNER_ORIGIN || "").replace(/\/$/, "");
  return /^https:\/\//.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : "";
}
function corsHeaders() {
  const origin = plannerOrigin();
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Kontur-Timestamp, X-Kontur-Nonce, X-Kontur-Signature",
    "Cache-Control": "private, no-store",
    Vary: "Origin",
  };
}
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: corsHeaders() });
}
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function hmac(value: string) {
  const secret = String(env.PUBLISH_SECRET || "");
  if (secret.length < 32) return "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}
function safeEqual(left: string, right: string) {
  if (left.length !== right.length || !left.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
function token() { return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""); }
function pin() { const value = new Uint32Array(1); crypto.getRandomValues(value); return String(100000 + (value[0] % 900000)); }

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_shares (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_value TEXT NOT NULL, pin_hash TEXT NOT NULL, expires_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, snapshot TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, view_count INTEGER NOT NULL DEFAULT 0, last_viewed_at TEXT)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS public_shares_project_idx ON public_shares (project_id, updated_at)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_share_sessions (session_hash TEXT PRIMARY KEY, share_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_share_attempts (share_id TEXT NOT NULL, visitor_key TEXT NOT NULL, window_started_at TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (share_id, visitor_key))`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_manage_nonces (nonce TEXT PRIMARY KEY, used_at TEXT NOT NULL)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_file_uploads (token_hash TEXT PRIMARY KEY, project_id TEXT NOT NULL, file_id TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, digest TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`),
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
async function authorize(request: Request, rawBody: string) {
  const origin = plannerOrigin();
  if (!origin || request.headers.get("origin") !== origin) return false;
  const timestamp = request.headers.get("x-kontur-timestamp") || "";
  const nonce = request.headers.get("x-kontur-nonce") || "";
  const supplied = request.headers.get("x-kontur-signature") || "";
  if (!/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{32,96}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > SIGNATURE_TTL_MS) return false;
  const expected = await hmac(`${timestamp}.${nonce}.${rawBody}`);
  if (!safeEqual(supplied, expected)) return false;
  try {
    await env.DB.prepare(`INSERT INTO public_manage_nonces (nonce, used_at) VALUES (?, ?)`).bind(nonce, new Date().toISOString()).run();
    return true;
  } catch { return false; }
}
function validId(value: unknown) { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value); }
function snapshotProjects(value: any) { return Array.isArray(value?.projects) ? value.projects : value?.project ? [value] : []; }
function safeSnapshot(value: any) {
  const projects = snapshotProjects(value);
  if (!value || typeof value !== "object" || !projects.length || projects.some((item: any) => !item?.project || !validId(item.project.id) || !Array.isArray(item.tasks) || !Array.isArray(item.documents))) return null;
  return JSON.stringify(value).length <= 750000 ? value : null;
}
function projectIdsFromSnapshot(value: any) { return snapshotProjects(value).map((item: any) => item.project.id).filter(validId); }
function pickPortfolio(catalog: any, requestedIds: unknown, anchorProjectId: string) {
  const available = new Map(snapshotProjects(catalog).map((item: any) => [item.project.id, item]));
  const ids = (Array.isArray(requestedIds) ? requestedIds : []).map(String).filter((id: string) => validId(id) && available.has(id)).slice(0, 20);
  if (!ids.includes(anchorProjectId) && available.has(anchorProjectId)) ids.unshift(anchorProjectId);
  const selected = ids.map((id: string) => available.get(id)).filter(Boolean);
  if (!selected.length) return null;
  const generatedAt = String(catalog.generatedAt || new Date().toISOString());
  return { version: 2, anchorProjectId, projects: selected, generatedAt };
}
async function refreshActiveShares(projectId: string, catalog: any, now: string) {
  if (!catalog) return;
  const result: any = await env.DB.prepare(`SELECT id,snapshot FROM public_shares WHERE project_id=? AND active=1 AND expires_at>?`).bind(projectId, now).all();
  const statements = [];
  for (const share of result.results || []) {
    let existing: any = null;
    try { existing = JSON.parse(share.snapshot); } catch { /* keep current snapshot if malformed */ }
    const next = pickPortfolio(catalog, projectIdsFromSnapshot(existing), projectId);
    if (next) statements.push(env.DB.prepare(`UPDATE public_shares SET snapshot=?,updated_at=? WHERE id=?`).bind(JSON.stringify(next), now, share.id));
  }
  if (statements.length) await env.DB.batch(statements);
}
async function list(projectId: string) {
  const [sharesResult, decisionsResult, feedbackResult, feedbackMessagesResult, updatesResult]: any = await env.DB.batch([
    env.DB.prepare(`SELECT id,token_value AS token,expires_at AS expiresAt,active,snapshot,created_by AS createdBy,created_at AS createdAt,updated_at AS updatedAt,view_count AS viewCount,last_viewed_at AS lastViewedAt FROM public_shares WHERE project_id=? ORDER BY created_at DESC`).bind(projectId),
    env.DB.prepare(`SELECT d.id,d.share_id AS shareId,d.project_id AS projectId,d.task_id AS taskId,d.task_title AS taskTitle,d.decision,d.comment,d.client_name AS clientName,d.decided_at AS decidedAt,d.updated_at AS updatedAt FROM public_stage_decisions d JOIN public_shares s ON s.id=d.share_id WHERE s.project_id=? ORDER BY d.updated_at DESC LIMIT 300`).bind(projectId),
    env.DB.prepare(`SELECT t.id,t.share_id AS shareId,t.project_id AS projectId,t.category,t.subject,t.task_id AS taskId,t.task_title AS taskTitle,t.client_name AS clientName,t.client_contact AS clientContact,t.status,t.created_at AS createdAt,t.updated_at AS updatedAt FROM public_feedback_threads t JOIN public_shares s ON s.id=t.share_id WHERE s.project_id=? ORDER BY t.updated_at DESC LIMIT 200`).bind(projectId),
    env.DB.prepare(`SELECT m.id,m.thread_id AS threadId,m.author_type AS authorType,m.author_name AS authorName,m.body,m.created_at AS createdAt FROM public_feedback_messages m JOIN public_feedback_threads t ON t.id=m.thread_id JOIN public_shares s ON s.id=t.share_id WHERE s.project_id=? ORDER BY m.created_at ASC LIMIT 1000`).bind(projectId),
    env.DB.prepare(`SELECT id,title,body,category,pinned,published_at AS publishedAt,created_by AS createdBy,created_at AS createdAt,updated_at AS updatedAt FROM public_updates WHERE project_id=? ORDER BY pinned DESC,published_at DESC LIMIT 200`).bind(projectId),
  ]);
  const messages = new Map<string, any[]>();
  for (const item of feedbackMessagesResult.results || []) messages.set(item.threadId, [...(messages.get(item.threadId) || []), item]);
  return {
    shares: (sharesResult.results || []).map((item: any) => { let stored: any = null; try { stored = JSON.parse(item.snapshot); } catch { /* legacy malformed snapshot */ } const projectNames = snapshotProjects(stored).map((project: any) => String(project.project?.name || "Проект")); const share = { ...item }; delete share.snapshot; return { ...share, projectNames, projectCount: projectNames.length || 1, active: Boolean(item.active), state: !item.active ? "revoked" : new Date(item.expiresAt).getTime() <= Date.now() ? "expired" : "active" }; }),
    decisions: decisionsResult.results || [],
    feedback: (feedbackResult.results || []).map((item: any) => ({ ...item, messages: messages.get(item.id) || [] })),
    updates: (updatesResult.results || []).map((item: any) => ({ ...item, pinned: Boolean(item.pinned) })),
  };
}

export async function OPTIONS(request: Request) {
  const origin = plannerOrigin();
  if (!origin || request.headers.get("origin") !== origin) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const rawBody = await request.text();
    if (!(await authorize(request, rawBody))) return json({ error: "Запрос не подтверждён" }, 401);
    const body: any = JSON.parse(rawBody);
    const projectId = String(body.projectId || "");
    if (!validId(projectId)) return json({ error: "Некорректный проект" }, 400);
    const now = new Date().toISOString();
    const snapshot = safeSnapshot(body.snapshot);

    if (body.action === "prepare_file_upload") {
      const file = body.file && typeof body.file === "object" ? body.file : null;
      if (!file || !validId(file.id) || typeof file.name !== "string" || !/^[a-f0-9]{64}$/.test(String(file.digest || ""))) return json({ error: "Некорректные данные документа" }, 400);
      const size = Number(file.size || 0);
      if (!size || size > 25 * 1024 * 1024) return json({ error: "Размер документа не поддерживается" }, 413);
      const uploadToken = token();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO public_file_uploads (token_hash,project_id,file_id,filename,mime_type,size_bytes,digest,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(await hash(uploadToken), projectId, file.id, String(file.name).slice(0, 180), String(file.type || "application/octet-stream").slice(0, 120), size, file.digest, expiresAt, now),
        env.DB.prepare(`DELETE FROM public_file_uploads WHERE expires_at<=?`).bind(now),
      ]);
      return json({ upload: { token: uploadToken, endpoint: `${new URL(request.url).origin}/api/manage/file`, expiresAt } });
    }

    if (body.action === "list") {
      if (snapshot) await refreshActiveShares(projectId, snapshot, now);
      return json(await list(projectId));
    }

    if (body.action === "feedback_reply") {
      const feedbackId = String(body.feedbackId || "");
      const message = String(body.message || "").trim().slice(0, 3000);
      const managerName = String(body.createdBy || "Руководитель проекта").trim().slice(0, 100) || "Руководитель проекта";
      if (!validId(feedbackId) || message.length < 2) return json({ error: "Введите ответ" }, 400);
      const thread: any = await env.DB.prepare(`SELECT t.id FROM public_feedback_threads t JOIN public_shares s ON s.id=t.share_id WHERE t.id=? AND s.project_id=?`).bind(feedbackId, projectId).first();
      if (!thread) return json({ error: "Обращение не найдено" }, 404);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO public_feedback_messages (id,thread_id,author_type,author_name,body,created_at) VALUES (?,?,'manager',?,?,?)`).bind(crypto.randomUUID(), feedbackId, managerName, message, now),
        env.DB.prepare(`UPDATE public_feedback_threads SET status='in_progress',updated_at=? WHERE id=?`).bind(now, feedbackId),
      ]);
      return json({ ok: true, ...(await list(projectId)) });
    }

    if (body.action === "feedback_status") {
      const feedbackId = String(body.feedbackId || "");
      const status = ["new", "in_progress", "resolved"].includes(body.status) ? body.status : "";
      if (!validId(feedbackId) || !status) return json({ error: "Некорректный статус" }, 400);
      const thread: any = await env.DB.prepare(`SELECT t.id FROM public_feedback_threads t JOIN public_shares s ON s.id=t.share_id WHERE t.id=? AND s.project_id=?`).bind(feedbackId, projectId).first();
      if (!thread) return json({ error: "Обращение не найдено" }, 404);
      await env.DB.prepare(`UPDATE public_feedback_threads SET status=?,updated_at=? WHERE id=?`).bind(status, now, feedbackId).run();
      return json({ ok: true, ...(await list(projectId)) });
    }

    if (body.action === "create_update") {
      const title = String(body.title || "").trim().slice(0, 180);
      const content = String(body.content || "").trim().slice(0, 5000);
      const category = ["progress", "milestone", "document", "deadline", "important"].includes(body.category) ? body.category : "progress";
      const author = String(body.createdBy || "Руководитель проекта").trim().slice(0, 100) || "Руководитель проекта";
      if (title.length < 3 || content.length < 3) return json({ error: "Укажите заголовок и текст обновления" }, 400);
      await env.DB.prepare(`INSERT INTO public_updates (id,project_id,title,body,category,pinned,published_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), projectId, title, content, category, body.pinned ? 1 : 0, now, author, now, now).run();
      return json({ ok: true, ...(await list(projectId)) }, 201);
    }

    if (body.action === "pin_update") {
      const updateId = String(body.updateId || "");
      if (!validId(updateId)) return json({ error: "Обновление не найдено" }, 400);
      const updated = await env.DB.prepare(`UPDATE public_updates SET pinned=?,updated_at=? WHERE id=? AND project_id=?`).bind(body.pinned ? 1 : 0, now, updateId, projectId).run();
      if (!updated.meta.changes) return json({ error: "Обновление не найдено" }, 404);
      return json({ ok: true, ...(await list(projectId)) });
    }

    if (body.action === "delete_update") {
      const updateId = String(body.updateId || "");
      if (!validId(updateId)) return json({ error: "Обновление не найдено" }, 400);
      const deleted = await env.DB.prepare(`DELETE FROM public_updates WHERE id=? AND project_id=?`).bind(updateId, projectId).run();
      if (!deleted.meta.changes) return json({ error: "Обновление не найдено" }, 404);
      return json({ ok: true, ...(await list(projectId)) });
    }

    if (body.action === "create") {
      if (!snapshot) return json({ error: "Некорректный снимок проекта" }, 400);
      const portfolio = pickPortfolio(snapshot, body.projectIds, projectId);
      if (!portfolio) return json({ error: "Выберите хотя бы один проект" }, 400);
      const shareToken = token();
      const sharePin = /^\d{4,10}$/.test(String(body.pin || "")) ? String(body.pin) : pin();
      const days = Math.min(90, Math.max(1, Number(body.days) || 14));
      const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      await env.DB.prepare(`INSERT INTO public_shares (id,project_id,token_hash,token_value,pin_hash,expires_at,active,snapshot,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?)`).bind(crypto.randomUUID(), projectId, await hash(shareToken), shareToken, await hash(`${shareToken}:${sharePin}`), expiresAt, JSON.stringify(portfolio), String(body.createdBy || "Владелец проекта").slice(0, 100), now, now).run();
      return json({ ok: true, created: { token: shareToken, pin: sharePin, expiresAt }, ...(await list(projectId)) }, 201);
    }

    const shareId = String(body.shareId || "");
    const share: any = await env.DB.prepare(`SELECT id,token_value FROM public_shares WHERE project_id=? AND id=?`).bind(projectId, shareId).first();
    if (!share) return json({ error: "Ссылка не найдена" }, 404);
    if (body.action === "revoke") {
      await env.DB.batch([env.DB.prepare(`UPDATE public_shares SET active=0,updated_at=? WHERE id=?`).bind(now, shareId), env.DB.prepare(`DELETE FROM public_share_sessions WHERE share_id=?`).bind(shareId)]);
      return json({ ok: true, ...(await list(projectId)) });
    }
    if (body.action === "rotate_pin") {
      const nextPin = pin();
      await env.DB.batch([env.DB.prepare(`UPDATE public_shares SET pin_hash=?,updated_at=? WHERE id=?`).bind(await hash(`${share.token_value}:${nextPin}`), now, shareId), env.DB.prepare(`DELETE FROM public_share_sessions WHERE share_id=?`).bind(shareId)]);
      return json({ ok: true, rotated: { pin: nextPin }, ...(await list(projectId)) });
    }
    return json({ error: "Неизвестное действие" }, 400);
  } catch (error) {
    console.error("share manage failed", error);
    return json({ error: "Не удалось обновить публичную ссылку" }, 503);
  }
}
