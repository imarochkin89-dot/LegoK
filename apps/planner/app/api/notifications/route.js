import { env } from "cloudflare:workers";
import {
  plannerNotificationPreferencesSchema,
  plannerNotificationReadsIndex,
  plannerNotificationReadsSchema,
} from "../../../db/schema";

export const dynamic = "force-dynamic";

const WORKSPACE_KEY = "kontur-shared-workspace-v1";
const DEFAULT_SETTINGS = { taskEvents: true, deadlines: true, comments: true, files: true };
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
  return {
    key: email ? await hashValue(email) : null,
    email,
    name: decodeFullName(request) || legacyName || (email ? displayNameFromEmail(email) : "Владелец"),
  };
}

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    await env.DB.batch([
      env.DB.prepare(plannerNotificationReadsSchema),
      env.DB.prepare(plannerNotificationPreferencesSchema),
      env.DB.prepare(plannerNotificationReadsIndex),
    ]);
  })();
  try { await schemaPromise; } catch (error) { schemaPromise = null; throw error; }
}

async function currentMember(actor) {
  if (!actor.key || !actor.email) return null;
  return env.DB.prepare(`
    SELECT member_key, email, display_name, role, status
    FROM planner_members
    WHERE workspace_key = ? AND member_key = ? AND status IN ('active', 'invited')
  `).bind(WORKSPACE_KEY, actor.key).first();
}

async function authorize(request) {
  const actor = await actorIdentity(request);
  if (!actor.key || !actor.email) return { error: json({ error: "Требуется вход" }, 401) };
  const member = await currentMember(actor);
  if (!member) return { error: json({ error: "Нет доступа к рабочему пространству" }, 403) };
  if (member?.role === "client") return { error: json({ error: "Уведомления команды недоступны в клиентском портале" }, 403) };
  return { actor, member, memberKey: member?.member_key || actor.key || "private-owner" };
}

function eventCategory(type) {
  if (type.includes("deadline")) return "deadlines";
  if (type.startsWith("comment_") || type.startsWith("public_feedback")) return "comments";
  if (type.startsWith("file_")) return "files";
  return "taskEvents";
}

function eventSeverity(type) {
  if (["task_completed", "subtask_completed", "file_uploaded", "risk_closed", "time_logged", "integration_connected", "integration_enabled"].includes(type)) return "success";
  if (type.includes("deadline")) return "warning";
  if (["task_deleted", "project_deleted", "member_removed", "file_deleted", "time_deleted", "integration_disabled", "integration_removed"].includes(type)) return "muted";
  return "info";
}

function differenceInDays(value, today) {
  return Math.round((new Date(`${value}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000);
}

function deadlineNotifications(workspace, today, now) {
  const notifications = [];
  for (const project of workspace?.projects || []) {
    for (const task of project.tasks || []) {
      const items = [
        ...(task.due && task.status !== "done" ? [{ id: task.id, title: task.title, due: task.due, kind: "task" }] : []),
        ...(task.subtasks || []).filter((item) => item.due && !item.done).map((item) => ({ id: item.id, title: item.text, due: item.due, kind: "subtask" })),
      ];
      for (const item of items) {
        const days = differenceInDays(item.due, today);
        if (days > 3 || days < -30) continue;
        const subject = item.kind === "subtask" ? "подзадачи" : "задачи";
        const label = days < 0
          ? `Просрочен срок ${subject} «${item.title}» на ${Math.abs(days)} дн.`
          : days === 0
            ? `Сегодня срок ${subject} «${item.title}»`
            : `До срока ${subject} «${item.title}» — ${days} дн.`;
        notifications.push({
          id: `deadline:${project.id}:${task.id}:${item.id}:${item.due}`,
          category: "deadlines",
          type: days < 0 ? "deadline_overdue" : days === 0 ? "deadline_today" : "deadline_soon",
          severity: days < 0 ? "danger" : days === 0 ? "warning" : "info",
          label,
          detail: project.name,
          projectId: project.id,
          taskId: task.id,
          actorName: "Контроль сроков",
          createdAt: now,
        });
      }
    }
  }
  return notifications;
}

function settingsFromRow(row) {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    taskEvents: Boolean(row.task_events),
    deadlines: Boolean(row.deadlines),
    comments: Boolean(row.comments),
    files: Boolean(row.files),
  };
}

async function notificationPayload(memberKey) {
  const [eventsResult, stateRow, readsResult, settingsRow] = await Promise.all([
    env.DB.prepare(`
      SELECT id, event_type, project_id, task_id, label, created_at, actor_name
      FROM planner_events
      WHERE user_key = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 120
    `).bind(WORKSPACE_KEY).all(),
    env.DB.prepare(`SELECT data FROM planner_workspace_state WHERE workspace_key = ?`).bind(WORKSPACE_KEY).first(),
    env.DB.prepare(`SELECT notification_key FROM planner_notification_reads WHERE workspace_key = ? AND member_key = ?`).bind(WORKSPACE_KEY, memberKey).all(),
    env.DB.prepare(`SELECT task_events, deadlines, comments, files FROM planner_notification_preferences WHERE workspace_key = ? AND member_key = ?`).bind(WORKSPACE_KEY, memberKey).first(),
  ]);
  let workspace = null;
  try { workspace = stateRow?.data ? JSON.parse(stateRow.data) : null; } catch { workspace = null; }
  const settings = settingsFromRow(settingsRow);
  const projectNames = new Map((workspace?.projects || []).map((project) => [project.id, project.name]));
  const events = (eventsResult.results || []).map((row) => ({
    id: `event:${row.id}`,
    category: eventCategory(row.event_type),
    type: row.event_type,
    severity: eventSeverity(row.event_type),
    label: row.label,
    detail: projectNames.get(row.project_id) || "Рабочее пространство",
    projectId: row.project_id || "",
    taskId: row.task_id || "",
    actorName: row.actor_name || "Участник команды",
    createdAt: row.created_at,
  }));
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const readKeys = new Set((readsResult.results || []).map((row) => row.notification_key));
  const notifications = [...deadlineNotifications(workspace, today, now), ...events]
    .filter((item) => settings[item.category])
    .map((item) => ({ ...item, read: readKeys.has(item.id) }))
    .sort((a, b) => Number(a.read) - Number(b.read) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 80);
  return { notifications, unreadCount: notifications.filter((item) => !item.read).length, settings };
}

function validKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 240;
}

export async function GET(request) {
  try {
    await ensureSchema();
    const authorization = await authorize(request);
    if (authorization.error) return authorization.error;
    return json(await notificationPayload(authorization.memberKey));
  } catch (error) {
    console.error("Notification read failed", error?.message || String(error));
    return json({ error: "Не удалось загрузить уведомления" }, 503);
  }
}

export async function POST(request) {
  try {
    await ensureSchema();
    const authorization = await authorize(request);
    if (authorization.error) return authorization.error;
    const body = await request.json();
    const now = new Date().toISOString();
    if (body.action === "mark_read") {
      if (!validKey(body.key)) return json({ error: "Некорректное уведомление" }, 400);
      await env.DB.prepare(`
        INSERT INTO planner_notification_reads (workspace_key, member_key, notification_key, read_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_key, member_key, notification_key) DO UPDATE SET read_at = excluded.read_at
      `).bind(WORKSPACE_KEY, authorization.memberKey, body.key, now).run();
    } else if (body.action === "mark_all_read") {
      const keys = Array.isArray(body.keys) ? [...new Set(body.keys.filter(validKey))].slice(0, 100) : [];
      if (keys.length) await env.DB.batch(keys.map((key) => env.DB.prepare(`
        INSERT INTO planner_notification_reads (workspace_key, member_key, notification_key, read_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_key, member_key, notification_key) DO UPDATE SET read_at = excluded.read_at
      `).bind(WORKSPACE_KEY, authorization.memberKey, key, now)));
    } else if (body.action === "update_settings") {
      const settings = {
        taskEvents: body.settings?.taskEvents !== false,
        deadlines: body.settings?.deadlines !== false,
        comments: body.settings?.comments !== false,
        files: body.settings?.files !== false,
      };
      await env.DB.prepare(`
        INSERT INTO planner_notification_preferences (workspace_key, member_key, task_events, deadlines, comments, files, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_key, member_key) DO UPDATE SET
          task_events = excluded.task_events,
          deadlines = excluded.deadlines,
          comments = excluded.comments,
          files = excluded.files,
          updated_at = excluded.updated_at
      `).bind(WORKSPACE_KEY, authorization.memberKey, Number(settings.taskEvents), Number(settings.deadlines), Number(settings.comments), Number(settings.files), now).run();
    } else return json({ error: "Неизвестное действие" }, 400);
    return json({ ok: true, ...(await notificationPayload(authorization.memberKey)) });
  } catch (error) {
    console.error("Notification write failed", error?.message || String(error));
    return json({ error: "Не удалось обновить уведомления" }, 503);
  }
}
