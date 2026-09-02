import { env } from "cloudflare:workers";
import { dispatchIntegrationEvent } from "../integrations/dispatch";

export const dynamic = "force-dynamic";

const WORKSPACE_KEY = "kontur-shared-workspace-v1";

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

async function actorIdentity(request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "";
  const name = request.headers.get("oai-authenticated-user-name")?.trim() || (email ? displayNameFromEmail(email) : "Владелец");
  return { key: email ? await hashValue(email) : null, email, name };
}

async function ensureSchema() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS planner_members (
      workspace_key TEXT NOT NULL,
      member_key TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      joined_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_key, member_key)
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS planner_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_key TEXT NOT NULL,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      author_key TEXT NOT NULL,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare(`
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
  `).run();
  const eventColumns = await env.DB.prepare("PRAGMA table_info(planner_events)").all();
  if (!(eventColumns.results || []).some((column) => column.name === "actor_name")) await env.DB.prepare("ALTER TABLE planner_events ADD COLUMN actor_name TEXT").run();
}

async function logEvent(type, label, actorName, createdAt, projectId = null, taskId = null) {
  await env.DB.prepare(`INSERT INTO planner_events (user_key, event_type, project_id, task_id, label, created_at, actor_name) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(WORKSPACE_KEY, type, projectId, taskId, String(label).slice(0, 260), createdAt, actorName).run();
}

async function ensureMember(actor) {
  if (!actor.key || !actor.email) return null;
  const member = await env.DB.prepare(`SELECT member_key, email, display_name, role, status FROM planner_members WHERE workspace_key = ? AND member_key = ?`).bind(WORKSPACE_KEY, actor.key).first();
  const now = new Date().toISOString();
  if (member) {
    await env.DB.prepare(`UPDATE planner_members SET display_name = ?, status = 'active', updated_at = ? WHERE workspace_key = ? AND member_key = ?`).bind(actor.name, now, WORKSPACE_KEY, actor.key).run();
    return { ...member, display_name: actor.name, status: "active" };
  }
  const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM planner_members WHERE workspace_key = ?`).bind(WORKSPACE_KEY).first();
  if (Number(count?.count || 0) > 0) return null;
  await env.DB.prepare(`INSERT INTO planner_members (workspace_key, member_key, email, display_name, role, status, joined_at, updated_at) VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?)`).bind(WORKSPACE_KEY, actor.key, actor.email, actor.name, now, now).run();
  return { member_key: actor.key, email: actor.email, display_name: actor.name, role: "owner", status: "active" };
}

async function payload(member) {
  if (member?.role === "client") return {
    actor: { key: member.member_key, email: member.email, name: member.display_name, role: member.role },
    members: [],
    comments: [],
  };
  const [membersResult, commentsResult] = await env.DB.batch([
    env.DB.prepare(`SELECT member_key, email, display_name, role, status, joined_at, updated_at FROM planner_members WHERE workspace_key = ? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 WHEN 'viewer' THEN 2 ELSE 3 END, display_name`).bind(WORKSPACE_KEY),
    env.DB.prepare(`SELECT id, project_id, task_id, author_key, author_name, body, created_at FROM planner_comments WHERE workspace_key = ? ORDER BY created_at DESC, id DESC LIMIT 500`).bind(WORKSPACE_KEY),
  ]);
  return {
    actor: member ? { key: member.member_key, email: member.email, name: member.display_name, role: member.role } : null,
    members: membersResult.results || [],
    comments: commentsResult.results || [],
  };
}

export async function GET(request) {
  try {
    await ensureSchema();
    const actor = await actorIdentity(request);
    if (!actor.key || !actor.email) return json({ error: "Требуется вход" }, 401);
    const member = await ensureMember(actor);
    if (!member) return json({ error: "Вы не добавлены в рабочее пространство" }, 403);
    return json(await payload(member));
  } catch (error) {
    console.error("D1 collaboration read failed", error?.message || String(error));
    return json({ error: "Не удалось загрузить совместную работу" }, 503);
  }
}

export async function POST(request) {
  try {
    await ensureSchema();
    const actor = await actorIdentity(request);
    const member = await ensureMember(actor);
    if (!member) return json({ error: "Нет доступа к рабочему пространству" }, 403);
    const body = await request.json();
    const now = new Date().toISOString();

    if (member.role === "client") return json({ error: "Клиентские обращения отправляются через портал" }, 403);

    if (body.action === "invite") {
      if (member.role !== "owner") return json({ error: "Только владелец может приглашать участников" }, 403);
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Укажите корректный email" }, 400);
      const role = ["editor", "viewer", "client"].includes(body.role) ? body.role : "editor";
      const memberKey = await hashValue(email);
      const name = String(body.name || "").trim().slice(0, 80) || displayNameFromEmail(email);
      await env.DB.prepare(`
        INSERT INTO planner_members (workspace_key, member_key, email, display_name, role, status, joined_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'invited', ?, ?)
        ON CONFLICT(workspace_key, member_key) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, updated_at = excluded.updated_at
      `).bind(WORKSPACE_KEY, memberKey, email, name, role, now, now).run();
      await logEvent("member_invited", `Добавлен участник «${name}»`, member.display_name, now);
    } else if (body.action === "update_role") {
      if (member.role !== "owner") return json({ error: "Только владелец может менять роли" }, 403);
      if (!["editor", "viewer", "client"].includes(body.role) || !body.memberKey || body.memberKey === member.member_key) return json({ error: "Эту роль изменить нельзя" }, 400);
      await env.DB.prepare(`UPDATE planner_members SET role = ?, updated_at = ? WHERE workspace_key = ? AND member_key = ? AND role != 'owner'`).bind(body.role, now, WORKSPACE_KEY, body.memberKey).run();
      await logEvent("member_role_changed", "Изменена роль участника", member.display_name, now);
    } else if (body.action === "remove_member") {
      if (member.role !== "owner") return json({ error: "Только владелец может удалять участников" }, 403);
      if (!body.memberKey || body.memberKey === member.member_key) return json({ error: "Владельца удалить нельзя" }, 400);
      await env.DB.prepare(`DELETE FROM planner_members WHERE workspace_key = ? AND member_key = ? AND role != 'owner'`).bind(WORKSPACE_KEY, body.memberKey).run();
      await logEvent("member_removed", "Участник удалён из рабочего пространства", member.display_name, now);
    } else if (body.action === "add_comment") {
      const text = String(body.text || "").trim();
      if (!text || text.length > 2000 || !body.projectId || !body.taskId) return json({ error: "Комментарий пуст или слишком длинный" }, 400);
      await env.DB.prepare(`INSERT INTO planner_comments (workspace_key, project_id, task_id, author_key, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(WORKSPACE_KEY, body.projectId, body.taskId, member.member_key, member.display_name, text, now).run();
      await logEvent("comment_added", "Добавлен комментарий к задаче", member.display_name, now, body.projectId, body.taskId);
      try { await dispatchIntegrationEvent({ projectId: body.projectId, type: "comment_added", label: "Добавлен комментарий к задаче", taskId: body.taskId, actorName: member.display_name, createdAt: now }); }
      catch (integrationError) { console.error("Comment webhook delivery failed", integrationError?.message || String(integrationError)); }
    } else if (body.action === "delete_comment") {
      const comment = await env.DB.prepare(`SELECT author_key, project_id, task_id FROM planner_comments WHERE workspace_key = ? AND id = ?`).bind(WORKSPACE_KEY, body.commentId).first();
      if (!comment || (comment.author_key !== member.member_key && member.role !== "owner")) return json({ error: "Комментарий удалить нельзя" }, 403);
      await env.DB.prepare(`DELETE FROM planner_comments WHERE workspace_key = ? AND id = ?`).bind(WORKSPACE_KEY, body.commentId).run();
      await logEvent("comment_deleted", "Удалён комментарий к задаче", member.display_name, now, comment.project_id, comment.task_id);
      try { await dispatchIntegrationEvent({ projectId: comment.project_id, type: "comment_deleted", label: "Удалён комментарий к задаче", taskId: comment.task_id, actorName: member.display_name, createdAt: now }); }
      catch (integrationError) { console.error("Comment webhook delivery failed", integrationError?.message || String(integrationError)); }
    } else return json({ error: "Неизвестное действие" }, 400);

    return json({ ok: true, ...(await payload(member)) });
  } catch (error) {
    console.error("D1 collaboration write failed", error?.message || String(error));
    return json({ error: "Не удалось выполнить действие" }, 503);
  }
}
