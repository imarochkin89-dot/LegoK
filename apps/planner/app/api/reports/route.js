import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
const WORKSPACE_KEY = "kontur-shared-workspace-v1";

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function actorKey(request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!email) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureSchema() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
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
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS planner_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_key TEXT NOT NULL,
      project_id TEXT NOT NULL,
      total_tasks INTEGER NOT NULL,
      completed_tasks INTEGER NOT NULL,
      overdue_tasks INTEGER NOT NULL,
      average_progress INTEGER NOT NULL,
      captured_at TEXT NOT NULL
    )
  `).run();
  const eventColumns = await env.DB.prepare("PRAGMA table_info(planner_events)").all();
  if (!(eventColumns.results || []).some((column) => column.name === "actor_name")) await env.DB.prepare("ALTER TABLE planner_events ADD COLUMN actor_name TEXT").run();
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
}

export async function GET(request) {
  try {
    await ensureSchema();
    const key = await actorKey(request);
    if (!key) return json({ error: "Требуется вход" }, 401);
    const member = await env.DB.prepare(`SELECT role FROM planner_members WHERE workspace_key = ? AND member_key = ?`).bind(WORKSPACE_KEY, key).first();
    if (!member || member.role === "client") return json({ error: "Нет доступа к отчётности" }, 403);
    const [eventsResult, snapshotsResult] = await env.DB.batch([
      env.DB.prepare(`
        SELECT id, event_type, project_id, task_id, label, created_at, actor_name
        FROM planner_events
        WHERE user_key = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 300
      `).bind(WORKSPACE_KEY),
      env.DB.prepare(`
        SELECT id, project_id, total_tasks, completed_tasks, overdue_tasks, average_progress, captured_at
        FROM planner_snapshots
        WHERE user_key = ?
        ORDER BY captured_at ASC, id ASC
        LIMIT 1500
      `).bind(WORKSPACE_KEY),
    ]);
    return json({
      events: eventsResult.results || [],
      snapshots: snapshotsResult.results || [],
    });
  } catch (error) {
    console.error("D1 reports read failed", error?.message || String(error));
    return json({ error: "Не удалось загрузить отчётность" }, 503);
  }
}
