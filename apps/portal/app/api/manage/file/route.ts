/* eslint-disable @typescript-eslint/no-explicit-any */
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function plannerOrigin() {
  const origin = String(env.PLANNER_ORIGIN || "").replace(/\/$/, "");
  return /^https:\/\//.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : "";
}
function corsHeaders() {
  const origin = plannerOrigin();
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "private, no-store",
    Vary: "Origin",
  };
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: corsHeaders() }); }
async function hashBytes(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function hashText(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function OPTIONS(request: Request) {
  const origin = plannerOrigin();
  if (!origin || request.headers.get("origin") !== origin) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function PUT(request: Request) {
  try {
    const origin = plannerOrigin();
    if (!origin || request.headers.get("origin") !== origin) return json({ error: "Источник запроса не разрешён" }, 403);
    if (!env.DB || !env.BUCKET) throw new Error("Storage bindings are unavailable");
    const uploadToken = new URL(request.url).searchParams.get("token") || "";
    if (uploadToken.length < 32) return json({ error: "Недействительный токен загрузки" }, 401);
    const row: any = await env.DB.prepare(`SELECT project_id,file_id,filename,mime_type,size_bytes,digest,expires_at FROM public_file_uploads WHERE token_hash=?`).bind(await hashText(uploadToken)).first();
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) return json({ error: "Токен загрузки истёк" }, 401);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_FILE_BYTES) return json({ error: "Файл превышает 25 МБ" }, 413);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES || bytes.byteLength !== Number(row.size_bytes)) return json({ error: "Размер файла не совпадает" }, 400);
    const digest = await hashBytes(bytes);
    if (digest !== row.digest) return json({ error: "Контрольная сумма файла не совпадает" }, 400);
    const objectKey = `public/${row.project_id}/${row.file_id}/${digest}`;
    await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: row.mime_type || "application/octet-stream" }, customMetadata: { filename: row.filename, projectId: row.project_id, fileId: row.file_id, digest } });
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO public_documents (project_id,file_id,object_key,filename,mime_type,size_bytes,digest,synced_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id,file_id) DO UPDATE SET object_key=excluded.object_key,filename=excluded.filename,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,digest=excluded.digest,synced_at=excluded.synced_at`).bind(row.project_id, row.file_id, objectKey, row.filename, row.mime_type, row.size_bytes, digest, now),
      env.DB.prepare(`DELETE FROM public_file_uploads WHERE token_hash=?`).bind(await hashText(uploadToken)),
    ]);
    return json({ ok: true, fileId: row.file_id, syncedAt: now });
  } catch (error) {
    console.error("public file upload failed", error);
    return json({ error: "Не удалось синхронизировать документ" }, 503);
  }
}
