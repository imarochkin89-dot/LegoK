import { env } from "cloudflare:workers";
import { safeEndpoint } from "./safety";

const WORKSPACE_KEY = "kontur-shared-workspace-v1";

function eventCategory(type) {
  if (type.includes("deadline")) return "deadlines";
  if (type.startsWith("risk_") || type.startsWith("issue_")) return "risks";
  if (type.startsWith("comment_")) return "comments";
  if (type.startsWith("file_")) return "files";
  if (type.startsWith("time_") || type.startsWith("timer_")) return "time";
  return "task_changes";
}

export async function dispatchIntegrationEvent({ projectId, type, label, taskId = null, actorName, createdAt = new Date().toISOString() }) {
  if (!env.DB || !projectId) return;
  const row = await env.DB.prepare(`SELECT data FROM planner_workspace_state WHERE workspace_key = ?`).bind(WORKSPACE_KEY).first();
  if (!row?.data) return;
  let state;
  try { state = JSON.parse(row.data); } catch { return; }
  const project = (state.projects || []).find((item) => item.id === projectId);
  if (!project) return;
  const category = eventCategory(type);
  const deliveries = [];
  for (const config of project.integrations || []) {
    if (config.connectorId !== "webhook" || config.status !== "connected" || !config.enabled || !config.events?.[category] || !config.destination) continue;
    let endpoint;
    try { endpoint = safeEndpoint(config.destination); } catch { continue; }
    deliveries.push(fetch(endpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Kontur-Project-Planner/1.0" },
      body: JSON.stringify({
        event: "project.events",
        source: "kontur-project-planner",
        project: { id: project.id, name: project.name },
        actorName,
        occurredAt: createdAt,
        events: [{ type, label, taskId }],
      }),
      redirect: "error",
      signal: AbortSignal.timeout(4500),
    }).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); }));
  }
  if (deliveries.length) await Promise.allSettled(deliveries);
}
