import { env } from "cloudflare:workers";
import { safeEndpoint } from "../integrations/safety";

export const dynamic = "force-dynamic";

const MAX_STATE_BYTES = 1_000_000;
const WORKSPACE_KEY = "kontur-shared-workspace-v1";
let schemaPromise;

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

async function hashValue(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function actorIdentity(request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "";
  const headerName = request.headers.get("oai-authenticated-user-name")?.trim();
  const derivedName = email ? email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) : "Владелец";
  return { key: email ? await hashValue(email) : null, email, name: headerName || derivedName };
}

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS planner_state (user_key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS planner_workspace_state (
        workspace_key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        updated_by TEXT
      )
    `).run();
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
  })();
  try { await schemaPromise; } catch (error) { schemaPromise = null; throw error; }
}

async function ensureMember(actor) {
  if (!actor.key || !actor.email) return null;
  const current = await env.DB.prepare(`SELECT member_key, email, display_name, role, status FROM planner_members WHERE workspace_key = ? AND member_key = ?`).bind(WORKSPACE_KEY, actor.key).first();
  const now = new Date().toISOString();
  if (current) {
    await env.DB.prepare(`UPDATE planner_members SET display_name = ?, status = 'active', updated_at = ? WHERE workspace_key = ? AND member_key = ?`).bind(actor.name, now, WORKSPACE_KEY, actor.key).run();
    return { ...current, display_name: actor.name, status: "active" };
  }
  const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM planner_members WHERE workspace_key = ?`).bind(WORKSPACE_KEY).first();
  if (Number(count?.count || 0) > 0) return null;
  await env.DB.prepare(`
    INSERT INTO planner_members (workspace_key, member_key, email, display_name, role, status, joined_at, updated_at)
    VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?)
  `).bind(WORKSPACE_KEY, actor.key, actor.email, actor.name, now, now).run();
  return { member_key: actor.key, email: actor.email, display_name: actor.name, role: "owner", status: "active" };
}

async function loadWorkspace(actor) {
  const shared = await env.DB.prepare(`SELECT data, revision, updated_at, updated_by FROM planner_workspace_state WHERE workspace_key = ?`).bind(WORKSPACE_KEY).first();
  if (shared || !actor.key) return shared;
  let sourceKey = actor.key;
  let personal = await env.DB.prepare(`SELECT data, updated_at FROM planner_state WHERE user_key = ?`).bind(sourceKey).first();
  if (!personal) {
    sourceKey = "private-owner";
    personal = await env.DB.prepare(`SELECT data, updated_at FROM planner_state WHERE user_key = ?`).bind(sourceKey).first();
  }
  if (!personal) return null;
  await env.DB.prepare(`
    INSERT INTO planner_workspace_state (workspace_key, data, revision, updated_at, updated_by)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(workspace_key) DO NOTHING
  `).bind(WORKSPACE_KEY, personal.data, personal.updated_at, actor.name).run();
  await env.DB.prepare(`UPDATE planner_events SET user_key = ? WHERE user_key = ?`).bind(WORKSPACE_KEY, sourceKey).run();
  await env.DB.prepare(`UPDATE planner_snapshots SET user_key = ? WHERE user_key = ?`).bind(WORKSPACE_KEY, sourceKey).run();
  return env.DB.prepare(`SELECT data, revision, updated_at, updated_by FROM planner_workspace_state WHERE workspace_key = ?`).bind(WORKSPACE_KEY).first();
}

function validState(value) {
  return value && typeof value === "object" && Array.isArray(value.projects) && value.projects.length > 0;
}

function clientSafeState(value) {
  if (!validState(value)) return value;
  return {
    projects: value.projects.map((project) => {
      const portal = project.clientPortal && typeof project.clientPortal === "object" ? project.clientPortal : {};
      const published = new Set(Array.isArray(portal.publishedTaskIds) ? portal.publishedTaskIds : []);
      return {
        id: project.id,
        name: project.name,
        description: project.description || "",
        color: project.color || "#2a8a68",
        clientPortal: portal,
        tasks: (project.tasks || []).filter((task) => published.has(task.id)).map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description || "",
          status: task.status,
          start: task.start || "",
          due: task.due || "",
          progress: progressOf(task),
          subtasks: (task.subtasks || []).map((item) => ({ id: item.id, text: item.text, done: Boolean(item.done), due: item.due || "" })),
        })),
      };
    }),
    activeProjectId: value.activeProjectId,
  };
}

function progressOf(task) {
  if (!task.subtasks?.length) return Math.min(100, Math.max(0, Number(task.progress) || 0));
  return Math.round((task.subtasks.filter((item) => item.done).length / task.subtasks.length) * 100);
}

function event(eventType, label, projectId = null, taskId = null) {
  return { eventType, label: String(label).slice(0, 260), projectId, taskId };
}

function buildEvents(previous, next) {
  if (!previous?.projects?.length) return [event("workspace_started", "Создано общее рабочее пространство")];
  const events = [];
  const previousProjects = new Map(previous.projects.map((project) => [project.id, project]));
  const nextProjects = new Map(next.projects.map((project) => [project.id, project]));
  for (const project of next.projects) {
    const beforeProject = previousProjects.get(project.id);
    if (!beforeProject) { events.push(event("project_created", `Создан проект «${project.name}»`, project.id)); continue; }
    if (beforeProject.name !== project.name) events.push(event("project_updated", `Проект переименован в «${project.name}»`, project.id));
    if (JSON.stringify(beforeProject.teamCapacity || {}) !== JSON.stringify(project.teamCapacity || {})) events.push(event("capacity_changed", `Обновлена недельная ёмкость команды в проекте «${project.name}»`, project.id));
    const beforeTasks = new Map((beforeProject.tasks || []).map((task) => [task.id, task]));
    const nextTasks = new Map((project.tasks || []).map((task) => [task.id, task]));
    for (const task of project.tasks || []) {
      const beforeTask = beforeTasks.get(task.id);
      if (!beforeTask) { events.push(event("task_created", `Добавлена задача «${task.title}»`, project.id, task.id)); continue; }
      if (beforeTask.status !== task.status) {
        const statusLabel = task.status === "done" ? "Завершена" : task.status === "progress" ? "Переведена в работу" : "Возвращена к выполнению";
        events.push(event(task.status === "done" ? "task_completed" : "task_status_changed", `${statusLabel} задача «${task.title}»`, project.id, task.id));
      } else if (progressOf(beforeTask) !== progressOf(task)) events.push(event("progress_changed", `Прогресс задачи «${task.title}» — ${progressOf(task)}%`, project.id, task.id));
      if ((beforeTask.due || "") !== (task.due || "")) events.push(event("deadline_changed", task.due ? `Срок задачи «${task.title}» установлен на ${task.due}` : `Срок задачи «${task.title}» снят`, project.id, task.id));
      if ((beforeTask.assigneeKey || "") !== (task.assigneeKey || "")) events.push(event("assignee_changed", `Изменён исполнитель задачи «${task.title}»`, project.id, task.id));
      if (beforeTask.effortHours != null && Number(beforeTask.effortHours) !== Number(task.effortHours || 0)) events.push(event("workload_changed", `Трудоёмкость задачи «${task.title}» — ${Number(task.effortHours) || 0} ч`, project.id, task.id));
      const beforeSubtasks = new Map((beforeTask.subtasks || []).map((item) => [item.id, item]));
      for (const subtask of task.subtasks || []) {
        const beforeSubtask = beforeSubtasks.get(subtask.id);
        if (!beforeSubtask) events.push(event("subtask_created", `Добавлена подзадача «${subtask.text}»`, project.id, task.id));
        else if (Boolean(beforeSubtask.done) !== Boolean(subtask.done)) events.push(event(subtask.done ? "subtask_completed" : "subtask_reopened", `${subtask.done ? "Завершена" : "Возобновлена"} подзадача «${subtask.text}»`, project.id, task.id));
        if (beforeSubtask && (beforeSubtask.due || "") !== (subtask.due || "")) events.push(event("subtask_deadline_changed", subtask.due ? `Срок подзадачи «${subtask.text}» установлен на ${subtask.due}` : `Срок подзадачи «${subtask.text}» снят`, project.id, task.id));
      }
      for (const beforeSubtask of beforeTask.subtasks || []) if (!(task.subtasks || []).some((item) => item.id === beforeSubtask.id)) events.push(event("subtask_deleted", `Удалена подзадача «${beforeSubtask.text}»`, project.id, task.id));
    }
    for (const beforeTask of beforeProject.tasks || []) if (!nextTasks.has(beforeTask.id)) events.push(event("task_deleted", `Удалена задача «${beforeTask.title}»`, project.id, beforeTask.id));
    const beforeRisks = new Map((beforeProject.risks || []).map((item) => [item.id, item]));
    const nextRisks = new Map((project.risks || []).map((item) => [item.id, item]));
    for (const item of project.risks || []) {
      const beforeRisk = beforeRisks.get(item.id);
      const typeLabel = item.type === "issue" ? "проблема" : "риск";
      if (!beforeRisk) {
        events.push(event(item.type === "issue" ? "issue_created" : "risk_created", `Добавлен ${typeLabel} «${item.title}»`, project.id, item.taskId || null));
        continue;
      }
      if (beforeRisk.status !== item.status) {
        const statusLabel = item.status === "closed" ? "Закрыт" : item.status === "mitigated" ? "Снижен" : item.status === "monitoring" ? "Взят под наблюдение" : "Открыт";
        events.push(event(item.status === "closed" ? "risk_closed" : "risk_status_changed", `${statusLabel} ${typeLabel} «${item.title}»`, project.id, item.taskId || null));
      } else if (Number(beforeRisk.probability) !== Number(item.probability) || Number(beforeRisk.impact) !== Number(item.impact)) {
        events.push(event("risk_assessment_changed", `Обновлена оценка: ${typeLabel} «${item.title}» — ${Number(item.probability) * Number(item.impact)}`, project.id, item.taskId || null));
      }
    }
    for (const beforeRisk of beforeProject.risks || []) if (!nextRisks.has(beforeRisk.id)) events.push(event("risk_deleted", `Удалена запись «${beforeRisk.title}»`, project.id, beforeRisk.taskId || null));
    if (Array.isArray(beforeProject.timeEntries)) {
      const beforeEntries = new Map(beforeProject.timeEntries.map((item) => [item.id, item]));
      const nextEntries = new Map((project.timeEntries || []).map((item) => [item.id, item]));
      for (const item of project.timeEntries || []) if (!beforeEntries.has(item.id)) {
        const taskTitle = nextTasks.get(item.taskId)?.title || "Удалённая задача";
        const hours = Math.round((Number(item.minutes) || 0) / 6) / 10;
        events.push(event("time_logged", `Добавлено ${hours} ч по задаче «${taskTitle}»`, project.id, item.taskId || null));
      }
      for (const item of beforeProject.timeEntries) if (!nextEntries.has(item.id)) events.push(event("time_deleted", "Удалена запись рабочего времени", project.id, item.taskId || null));
    }
    const beforeTimers = beforeProject.activeTimers || {};
    const nextTimers = project.activeTimers || {};
    for (const [memberKey, timer] of Object.entries(nextTimers)) if (!beforeTimers[memberKey]) {
      const taskTitle = nextTasks.get(timer.taskId)?.title || "Удалённая задача";
      events.push(event("timer_started", `Запущен таймер по задаче «${taskTitle}»`, project.id, timer.taskId || null));
    }
    if (Array.isArray(beforeProject.integrations)) {
      const beforeIntegrations = new Map(beforeProject.integrations.map((item) => [item.id, item]));
      const nextIntegrations = new Map((project.integrations || []).map((item) => [item.id, item]));
      for (const item of project.integrations || []) {
        const beforeItem = beforeIntegrations.get(item.id);
        if (!beforeItem) events.push(event("integration_added", `Настроена интеграция «${item.name || item.connectorId}»`, project.id));
        else if (beforeItem.status !== "connected" && item.status === "connected") events.push(event("integration_connected", `Подключена интеграция «${item.name || item.connectorId}»`, project.id));
        else if (Boolean(beforeItem.enabled) !== Boolean(item.enabled)) events.push(event(item.enabled ? "integration_enabled" : "integration_disabled", `${item.enabled ? "Включена" : "Приостановлена"} интеграция «${item.name || item.connectorId}»`, project.id));
      }
      for (const item of beforeProject.integrations) if (!nextIntegrations.has(item.id)) events.push(event("integration_removed", `Удалена настройка интеграции «${item.name || item.connectorId}»`, project.id));
    }
    const beforeMessages = new Set((beforeProject.assistantMessages || []).map((item) => item.id));
    for (const item of project.assistantMessages || []) if (item.role === "assistant" && !beforeMessages.has(item.id)) {
      events.push(event("assistant_answered", `AI-помощник подготовил: «${item.title || "ответ по проекту"}»`, project.id, item.taskIds?.[0] || null));
    }
    const beforeResources = new Map((beforeProject.resources || []).map((item) => [item.id, item]));
    const nextResources = new Map((project.resources || []).map((item) => [item.id, item]));
    for (const item of project.resources || []) {
      const beforeItem = beforeResources.get(item.id);
      if (!beforeItem) {
        events.push(event("resource_created", `Добавлен ресурс «${item.name || "Без названия"}»`, project.id, item.taskId || null));
        continue;
      }
      if (beforeItem.status !== item.status) {
        events.push(event("resource_status_changed", `Статус ресурса «${item.name || "Без названия"}» изменён`, project.id, item.taskId || null));
      } else if (Number(beforeItem.quantity) !== Number(item.quantity) || Number(beforeItem.reserved) !== Number(item.reserved)) {
        events.push(event("resource_quantity_changed", `Обновлено наличие ресурса «${item.name || "Без названия"}»`, project.id, item.taskId || null));
      }
    }
    for (const item of beforeProject.resources || []) if (!nextResources.has(item.id)) {
      events.push(event("resource_deleted", `Удалён ресурс «${item.name || "Без названия"}»`, project.id, item.taskId || null));
    }
  }
  for (const beforeProject of previous.projects) if (!nextProjects.has(beforeProject.id)) events.push(event("project_deleted", `Удалён проект «${beforeProject.name}»`, beforeProject.id));
  return events.slice(0, 40);
}

function snapshotOf(project, today) {
  const tasks = project.tasks || [];
  const completed = tasks.filter((task) => task.status === "done").length;
  const overdue = tasks.filter((task) => task.due && task.status !== "done" && task.due < today).length;
  const average = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + progressOf(task), 0) / tasks.length) : 0;
  return { projectId: project.id, total: tasks.length, completed, overdue, average };
}

async function recordReporting(previous, next, createdAt, actorName, eventItems = buildEvents(previous, next)) {
  const statements = [];
  for (const item of eventItems) statements.push(env.DB.prepare(`
    INSERT INTO planner_events (user_key, event_type, project_id, task_id, label, created_at, actor_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(WORKSPACE_KEY, item.eventType, item.projectId, item.taskId, item.label, createdAt, actorName));
  const today = createdAt.slice(0, 10);
  for (const project of next.projects) {
    const snapshot = snapshotOf(project, today);
    statements.push(env.DB.prepare(`
      INSERT INTO planner_snapshots (user_key, project_id, total_tasks, completed_tasks, overdue_tasks, average_progress, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(WORKSPACE_KEY, snapshot.projectId, snapshot.total, snapshot.completed, snapshot.overdue, snapshot.average, createdAt));
  }
  if (statements.length) await env.DB.batch(statements);
}

function integrationEventCategory(type) {
  if (type.startsWith("integration_")) return null;
  if (type.includes("deadline")) return "deadlines";
  if (type.startsWith("risk_") || type.startsWith("issue_")) return "risks";
  if (type.startsWith("comment_")) return "comments";
  if (type.startsWith("file_")) return "files";
  if (type.startsWith("time_") || type.startsWith("timer_")) return "time";
  return "task_changes";
}

async function dispatchWebhooks(next, eventItems, occurredAt, actorName) {
  const deliveries = [];
  for (const project of next.projects || []) {
    const projectEvents = eventItems.filter((item) => item.projectId === project.id && integrationEventCategory(item.eventType));
    if (!projectEvents.length) continue;
    for (const config of project.integrations || []) {
      if (config.connectorId !== "webhook" || config.status !== "connected" || !config.enabled || !config.destination) continue;
      const selected = projectEvents.filter((item) => config.events?.[integrationEventCategory(item.eventType)]);
      if (!selected.length) continue;
      let endpoint;
      try { endpoint = safeEndpoint(config.destination); }
      catch (error) { console.error("Webhook endpoint rejected", error?.message || String(error)); continue; }
      deliveries.push(fetch(endpoint.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Kontur-Project-Planner/1.0" },
        body: JSON.stringify({
          event: "project.events",
          source: "kontur-project-planner",
          project: { id: project.id, name: project.name },
          actorName,
          occurredAt,
          events: selected.map((item) => ({ type: item.eventType, label: item.label, taskId: item.taskId || null })),
        }),
        redirect: "error",
        signal: AbortSignal.timeout(4500),
      }).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); }));
    }
  }
  if (deliveries.length) {
    const results = await Promise.allSettled(deliveries);
    for (const result of results) if (result.status === "rejected") console.error("Webhook delivery failed", result.reason?.message || String(result.reason));
  }
}

export async function GET(request) {
  try {
    await ensureSchema();
    const actor = await actorIdentity(request);
    if (!actor.key || !actor.email) return json({ error: "Требуется вход" }, 401);
    const member = await ensureMember(actor);
    if (!member) return json({ error: "Нет доступа к рабочему пространству" }, 403);
    const row = await loadWorkspace(actor);
    const storedData = row ? JSON.parse(row.data) : null;
    return json({ data: member?.role === "client" ? clientSafeState(storedData) : storedData, revision: Number(row?.revision || 0), updatedAt: row?.updated_at || null, updatedBy: row?.updated_by || null, actor: member ? { key: member.member_key, name: member.display_name, email: member.email, role: member.role } : null });
  } catch (error) {
    console.error("D1 shared read failed", error?.message || String(error));
    return json({ error: "Не удалось загрузить общее пространство" }, 503);
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    if (!validState(body?.data)) return json({ error: "Некорректный формат данных" }, 400);
    const serialized = JSON.stringify(body.data);
    if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) return json({ error: "Данные превышают допустимый размер" }, 413);
    await ensureSchema();
    const actor = await actorIdentity(request);
    const member = await ensureMember(actor);
    if (!member || !["owner", "editor"].includes(member.role)) return json({ error: "Недостаточно прав для изменения" }, 403);
    const current = await loadWorkspace(actor);
    const currentRevision = Number(current?.revision || 0);
    const baseRevision = Number.isFinite(Number(body.baseRevision)) ? Number(body.baseRevision) : currentRevision;
    if (current && baseRevision !== currentRevision) return json({ error: "Данные уже изменены другим участником", conflict: true, data: JSON.parse(current.data), revision: currentRevision, updatedBy: current.updated_by }, 409);
    const updatedAt = new Date().toISOString();
    const nextRevision = currentRevision + 1;
    if (current) {
      const result = await env.DB.prepare(`UPDATE planner_workspace_state SET data = ?, revision = ?, updated_at = ?, updated_by = ? WHERE workspace_key = ? AND revision = ?`).bind(serialized, nextRevision, updatedAt, actor.name, WORKSPACE_KEY, currentRevision).run();
      if (!Number(result.meta?.changes || 0)) {
        const latest = await loadWorkspace(actor);
        return json({ error: "Данные уже изменены другим участником", conflict: true, data: JSON.parse(latest.data), revision: Number(latest.revision), updatedBy: latest.updated_by }, 409);
      }
    } else await env.DB.prepare(`INSERT INTO planner_workspace_state (workspace_key, data, revision, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)`).bind(WORKSPACE_KEY, serialized, updatedAt, actor.name).run();
    const previousState = current?.data ? JSON.parse(current.data) : null;
    const eventItems = buildEvents(previousState, body.data);
    try { await recordReporting(previousState, body.data, updatedAt, actor.name, eventItems); }
    catch (reportingError) { console.error("D1 reporting write failed", reportingError?.message || String(reportingError)); }
    try { await dispatchWebhooks(body.data, eventItems, updatedAt, actor.name); }
    catch (integrationError) { console.error("Webhook dispatch failed", integrationError?.message || String(integrationError)); }
    return json({ ok: true, revision: nextRevision, updatedAt, updatedBy: actor.name });
  } catch (error) {
    console.error("D1 shared write failed", error?.message || String(error));
    return json({ error: "Не удалось сохранить общие данные" }, 503);
  }
}
