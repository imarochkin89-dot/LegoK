import { env } from "cloudflare:workers";
import { safeEndpoint } from "./safety";

export const dynamic = "force-dynamic";

const WORKSPACE_KEY = "kontur-shared-workspace-v1";

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

async function hashValue(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authorize(request) {
  if (!env.DB) return { error: json({ error: "Хранилище интеграций недоступно" }, 503) };
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "";
  if (!email) return { error: json({ error: "Требуется авторизация" }, 401) };
  const memberKey = await hashValue(email);
  const member = await env.DB.prepare(`
    SELECT role, status FROM planner_members
    WHERE workspace_key = ? AND member_key = ? AND status = 'active'
  `).bind(WORKSPACE_KEY, memberKey).first();
  if (!member || !["owner", "editor"].includes(member.role)) return { error: json({ error: "Недостаточно прав для проверки интеграции" }, 403) };
  return { member };
}

export async function POST(request) {
  try {
    const auth = await authorize(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    if (body.action !== "test" || body.connectorId !== "webhook") return json({ error: "Неизвестное действие" }, 400);
    const endpoint = safeEndpoint(body.endpoint);
    const payload = {
      event: "integration.test",
      source: "kontur-project-planner",
      project: { id: String(body.projectId || "").slice(0, 160), name: String(body.projectName || "Проект").slice(0, 240) },
      occurredAt: new Date().toISOString(),
      data: { message: "Тестовое событие интеграции" },
    };
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Kontur-Project-Planner/1.0" },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return json({ error: `Получатель ответил кодом ${response.status}` }, 502);
    return json({ ok: true, deliveredTo: endpoint.hostname, status: response.status });
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "Получатель не ответил за 8 секунд" : error?.message || "Не удалось проверить webhook";
    return json({ error: message }, 400);
  }
}
